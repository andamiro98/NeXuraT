import type {
    EditableWbsRow,
    GanttLinkItem,
    GanttTaskItem,
    RelationType,
} from "./types";

// 착수일~종료일 차이를 "일수"로 계산한다.
// 종료일 - 착수일
export function computeDurationDays(
    startDate: string,
    endDate: string
): number | null {
    if (!startDate || !endDate) return null;

    const start = new Date(startDate);
    const end = new Date(endDate);

    // 날짜 형식이 이상하면 null
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
    }

    const diffMs = end.getTime() - start.getTime();

    // 종료일이 시작일보다 빠르면 잘못된 범위
    if (diffMs < 0) return null;

    // 밀리초 -> 일(day) 변환
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// 사용자가 입력하는 관계유형(FS, FF, SS, SF)을
// SVAR Gantt가 이해하는 link type으로 변환한다.
export function mapRelationType(
    relationType: RelationType
): "e2s" | "e2e" | "s2s" | "s2e" | null {
    switch (relationType) {
        case "FS":
            return "e2s";
        case "FF":
            return "e2e";
        case "SS":
            return "s2s";
        case "SF":
            return "s2e";
        default:
            return null;
    }
}

// 현재 open 상태를 기준으로 "실제 화면에 보일 행"만 걸러낸다.
// 부모가 닫혀 있으면 그 아래 자식은 화면에 보이면 안 된다.
export function getVisibleRows(rows: EditableWbsRow[]): EditableWbsRow[] {
    const rowMap = new Map<number, EditableWbsRow>();
    rows.forEach((row) => rowMap.set(row.id, row));

    return rows.filter((row) => {
        let parentId = row.parentId;

        while (parentId !== 0) {
            const parent = rowMap.get(parentId);

            // 부모를 못 찾으면 일단 보여준다.
            if (!parent) return true;

            // 상위 부모 중 하나라도 닫혀 있으면 숨긴다.
            if (!parent.open) return false;

            parentId = parent.parentId;
        }

        return true;
    });
}

// 초기 캘린더 범위
// 현재 월의 1일 ~ 4개월 뒤 말일까지 보여주도록 설정
export function getCalendarRange(): { start: Date; end: Date } {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 4, 0);
    return { start, end };
}

// 착수일/종료일이 둘 다 있는데 duration이 null이면
// 잘못된 날짜 범위라고 볼 수 있다.
export function isInvalidDateRange(row: EditableWbsRow): boolean {
    return !!row.startDate && !!row.endDate && row.durationDays === null;
}

// 현재 rows를 오른쪽 Gantt가 사용할 수 있는 tasks/links로 변환한다.
// 이 함수가 가장 중요하다.
export function buildScheduledGanttData(rows: EditableWbsRow[]): {
    tasks: GanttTaskItem[];
    links: GanttLinkItem[];
} {
    // 날짜가 정상적으로 입력된 행만 Gantt로 보낸다.
    const scheduledRows = rows.filter(
        (row) =>
            row.startDate &&
            row.endDate &&
            computeDurationDays(row.startDate, row.endDate) !== null
    );

    // 현재 스케줄된 행들의 id 집합
    const scheduledIdSet = new Set<number>(scheduledRows.map((row) => row.id));

    // 핵심 수정 포인트
    // "원본 트리 기준 자식 유무"가 아니라
    // "현재 스케줄된 행들 사이에서 실제 자식이 있는지" 다시 계산해야 한다.
    const scheduledChildrenCount = new Map<number, number>();

    for (const row of scheduledRows) {
        if (row.parentId !== 0 && scheduledIdSet.has(row.parentId)) {
            scheduledChildrenCount.set(
                row.parentId,
                (scheduledChildrenCount.get(row.parentId) ?? 0) + 1
            );
        }
    }

    // 선행작업 코드로 행을 찾기 위한 맵
    const codeMap = new Map<string, EditableWbsRow>();
    for (const row of scheduledRows) {
        if (row.wbsCode) {
            codeMap.set(row.wbsCode, row);
        }
    }

    // Gantt task 생성
    const tasks: GanttTaskItem[] = scheduledRows.map((row) => {
        // 현재 스케줄된 자식이 실제로 있는지 확인
        const hasScheduledChildren = (scheduledChildrenCount.get(row.id) ?? 0) > 0;

        return {
            id: row.id,

            // 부모도 스케줄되어 있을 때만 parent 연결
            parent:
                row.parentId !== 0 && scheduledIdSet.has(row.parentId)
                    ? row.parentId
                    : 0,

            text: row.workName,
            start: new Date(row.startDate),
            end: new Date(row.endDate),

            // 자식이 실제로 있을 때만 summary
            type: hasScheduledChildren ? "summary" : "task",

            // summary일 때만 open=true
            open: hasScheduledChildren,

            // 추가 필드 (내장 그리드에서 표시용)
            wbsCode: row.wbsCode,
            totalAmount: row.totalAmount,
            materialAmount: row.materialAmount,
            laborAmount: row.laborAmount,
            expenseAmount: row.expenseAmount,
            predecessorCode: row.predecessorCode,
            relationType: row.relationType,
            lag: row.lag,
            durationDays: row.durationDays,
        };
    });

    // Gantt link 생성
    // 선행작업 코드 + 관계유형이 입력된 경우에만 생성
    const links: GanttLinkItem[] = scheduledRows.flatMap((row) => {
        if (!row.predecessorCode || !row.relationType) {
            return [];
        }

        const predecessor = codeMap.get(row.predecessorCode);
        const mappedType = mapRelationType(row.relationType);

        if (!predecessor || !mappedType) {
            return [];
        }

        return [
            {
                id: `${predecessor.id}-${row.id}-${mappedType}`,
                source: predecessor.id,
                target: row.id,
                type: mappedType,
                ...(row.lag !== 0 ? { lag: row.lag } : {}),
            },
        ];
    });

    return { tasks, links };
}