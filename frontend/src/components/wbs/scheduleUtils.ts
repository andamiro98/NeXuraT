import type {
    EditableWbsRow,
    GanttLinkItem,
    GanttTaskItem,
    RelationType,
} from "./types";
import { countBusinessDays, isBusinessDay } from "korean-holidays";

const DAY_MS = 1000 * 60 * 60 * 24;
function isValidDate(date: Date): boolean {
    return !Number.isNaN(date.getTime());
}

function toSafeDate(value: string | Date | null | undefined): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return isValidDate(parsed) ? parsed : null;
}

export function toDateInputValue(value: string | Date | null | undefined): string {
    const parsed = toSafeDate(value);
    if (!parsed) return "";

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// 착수일~종료일 차이를 영업일(주말, 공휴일 제외) 기준으로 "일수"로 계산
// 같은 날 시작/종료하면 1일로 본다 (해당 일이 영업일인 경우).
export function computeDurationDays(
    startDate: string,
    endDate: string
): number | null {
    const start = toSafeDate(startDate);
    const end = toSafeDate(endDate);

    if (!start || !end) return null;

    const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const diffMs = endOnly.getTime() - startOnly.getTime();
    if (diffMs < 0) return null;

    const bizBetween = countBusinessDays(startOnly, endOnly);
    const startBiz = isBusinessDay(startOnly) ? 1 : 0;

    return bizBetween + startBiz;
}


export function computeGanttDurationDays(
    startDate: string,
    endDate: string
): number | null {
    const start = toSafeDate(startDate);
    const end = toSafeDate(endDate);

    if (!start || !end) return null;

    const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const diffMs = endOnly.getTime() - startOnly.getTime();
    if (diffMs < 0) return null;

    return Math.floor(diffMs / DAY_MS);
}

// 금액 콤마 포맷터
export function formatMoney(val: number): string {
    if (!val) return "0";
    return val.toLocaleString("en-US");
}

// Svar Gantt가 이해하는 link type으로 변환
export function mapRelationType(
    relationType: RelationType
): "e2s" | "e2e" | "s2s" | "s2e" | null {
    switch (relationType) {
        case "FS": return "e2s";
        case "FF": return "e2e";
        case "SS": return "s2s";
        case "SF": return "s2e";
        default: return null;
    }
}

// 화면 로딩 초기 캘린더 범위
export function getCalendarRange(): { start: Date; end: Date } {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 4, 0);
    return { start, end };
}

export function getCalendarRangeFromRows(rows: EditableWbsRow[]): { start: Date; end: Date } {
    const dates = rows.flatMap((row) => {
        const start = toSafeDate(row.startDate);
        const end = toSafeDate(row.endDate);
        return [start, end].filter(Boolean) as Date[];
    });

    if (dates.length === 0) return getCalendarRange();

    const minTime = Math.min(...dates.map((date) => date.getTime()));
    const maxTime = Math.max(...dates.map((date) => date.getTime()));

    const minDate = new Date(minTime);
    const maxDate = new Date(maxTime);

    return {
        start: new Date(minDate.getFullYear(), minDate.getMonth() - 1, 1),
        end: new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0),
    };
}

// Native Svar Gantt에 전달할 포맷으로 엑셀 모델 변환
export function buildScheduledGanttData(rows: EditableWbsRow[]): {
    tasks: GanttTaskItem[];
    links: GanttLinkItem[];
} {
    const codeMap = new Map<string, number>();
    for (const row of rows) {
        if (row.wbsCode) codeMap.set(row.wbsCode, row.id);
    }

    const { start: calStart } = getCalendarRangeFromRows(rows);

    const tasks: GanttTaskItem[] = rows.map((row) => {
        const rowStart = toSafeDate(row.startDate);
        const rowEnd = toSafeDate(row.endDate);

        let parsedStart = rowStart ?? rowEnd ?? calStart;
        let parsedEnd = rowEnd ?? rowStart ?? calStart;

        // 종료일이 착수일보다 빠르면 간트 렌더링 오류를 막기 위해 착수일과 동일하게 맞춘다.
        if (parsedEnd.getTime() < parsedStart.getTime()) {
            parsedEnd = new Date(parsedStart);
        }

        const durationDays = computeDurationDays(
            toDateInputValue(parsedStart),
            toDateInputValue(parsedEnd)
        );
        const durationGanttDays = computeGanttDurationDays(
            toDateInputValue(parsedStart),
            toDateInputValue(parsedEnd)
        );


        const taskItem: GanttTaskItem = {
            id: row.id,
            text: row.workName || "Untitled",
            start: parsedStart,
            end: parsedEnd,
            duration: durationGanttDays ?? 1,
            type: "task",
            open: row.open,

            wbsCode: row.wbsCode,
            totalAmount: row.totalAmount,
            materialAmount: row.materialAmount,
            laborAmount: row.laborAmount,
            expenseAmount: row.expenseAmount,
            startDate: toDateInputValue(parsedStart),
            endDate: toDateInputValue(parsedEnd),
            durationDays: durationDays,
            predecessorCode: row.predecessorCode,
            relationType: row.relationType,
            lag: row.lag,

            es: row.es,
            ef: row.ef,
            ls: row.ls,
            lf: row.lf,
            tf: row.tf,
            ff: row.ff,
            isCritical: row.isCritical
        };

        if (row.parentId !== 0 && row.parentId != null) {
            taskItem.parent = row.parentId;
        }

        return taskItem;
    });

    const links: GanttLinkItem[] = rows.flatMap((row) => {
        if (!row.predecessorCode || !row.relationType) return [];
        const predId = codeMap.get(row.predecessorCode);
        const mappedType = mapRelationType(row.relationType as RelationType);

        if (!predId || !mappedType) return [];
        if (predId === row.id) return [];

        return [{
            id: `${predId}-${row.id}-${mappedType}`,
            source: predId,
            target: row.id,
            type: mappedType,
            lag: row.lag ? Number(row.lag) : 0,
        }];
    });

    return { tasks, links };
}
