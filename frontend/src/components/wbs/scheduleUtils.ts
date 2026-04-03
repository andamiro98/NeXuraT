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
        return [start, end].filter(Boolean) as Date[]; // truthy 값
    });

    if (dates.length === 0) return getCalendarRange();

    const minTime = Math.min(...dates.map((date) => date.getTime()));
    const maxTime = Math.max(...dates.map((date) => date.getTime()));

    const minDate = new Date(minTime);
    const maxDate = new Date(maxTime);

    return {
        start: new Date(minDate.getFullYear(), minDate.getMonth() - 1, 1), // 최소 날짜가 속한 달의 한 달 전 1일
        end: new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0), // 최대 날짜가 속한 달의의 한 달 후 마지막 일
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

    // const { start: calStart } = getCalendarRangeFromRows(rows);

    const tasks: GanttTaskItem[] = rows.map((row) => {
        const rowStart = toSafeDate(row.startDate);
        const rowEnd = toSafeDate(row.endDate);

        let parsedStart = rowStart! ; // ?? calStart
        let parsedEnd = rowEnd! ;

        // 종료일이 착수일보다 빠르면 간트 렌더링 오류를 막기 위해 착수일과 동일하게
        if (parsedEnd.getTime() < parsedStart.getTime()) {
            parsedEnd = new Date(parsedStart);
        }

        // 착수일부터 종료일까지 계산
        const durationDays = computeDurationDays(
            toDateInputValue(parsedStart),
            toDateInputValue(parsedEnd)
        );

        // 공휴일 등 뺸 영업일 계산
        const durationGanttDays = computeGanttDurationDays(
            toDateInputValue(parsedStart),
            toDateInputValue(parsedEnd)
        );

        // console.log("durationDays", durationDays, "durationGanttDays", durationGanttDays);

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

    // 작업들을 하나씩 순회하며 다중 선행작업(복수 링크) 지원을 대비한 간트 링크선(GanttLinkItem) 객체 배열 모음 생성
    const links: GanttLinkItem[] = rows.flatMap((row) => {
        // 단 하나의 선행작업 정보라도 등록돼있지 않으면 연결선이 필요 없으므로 빈 배열 바로 리턴
        if (!row.predecessorCode) return [];

        // 작성된 쉼표(,)를 기준으로 문자열을 잘라낸 후 개별 요소의 좌우 공백을 제거하고 빈 문자열 필터링
        const predCodes = row.predecessorCode.split(",").map(s => s.trim()).filter(Boolean);
        // 관계 유형 쉼표로 구분, 해당 위치 요소가 비정상 포맷이면 기본 관계유형인 "FS" 할당
        const relTypes = String(row.relationType ?? "").split(",").map(v => {
            const u = v.trim().toUpperCase();
            if (u === "FS" || u === "SS" || u === "FF" || u === "SF") return u as RelationType;
            return "FS" as RelationType;
        });
        // 간격(Lag) 값이 문자이거나 비어있으면 모두 정수 0으로 강제 형변환 처리
        const lagValues = String(row.lag ?? "").split(",").map(v => v.trim()).map(v => {
            const n = parseInt(v, 10);
            return Number.isNaN(n) ? 0 : n;
        });

        // 결과적으로 뽑아낸 각 개별 선행작업 코드들마다 하나의 GanttLinkItem을 만들어 평탄화(flatMap) 리턴 처리
        return predCodes.flatMap((predCode, i) => {
            let code = predCode;
            let rel = relTypes[i] || relTypes[0] || ("FS" as RelationType);
            let lag = lagValues[i] ?? lagValues[0] ?? 0;

            {/*엑셀에서 합쳐진 형태 "A100FS+2"처럼 입력되는 임베디드 스트링에 대한 파싱 구조 대비 */}
            /*const pattern = /^(.+?)(FS|SS|FF|SF)([+-]\d+)?$/i;
            const m = predCode.match(pattern);
            if (m) {
                code = m[1].trim(); // 1그룹: WBS 코드
                rel = m[2].toUpperCase() as RelationType; // 2그룹: 관계 연결 타입 (알파벳 강제 대문자화)
                lag = m[3] ? parseInt(m[3], 10) : 0; // 3그룹: 지연시간 산출 (없는 경우 숫자 0)
            }*/

            // 코드맵(codeMap) 컬렉션을 통해 선행작업의 문자열 코드 값이 간트 내부 고유 숫자 ID 중에 속하는지 식별
            const predId = codeMap.get(code); // 현재 공종(row) WBS의 선행 WBS 코드의 id

            // 일반 프로젝트용 타입(FS, SS...)을 SVAR UI 네이티브 간트의 연결 속성 호환 데이터(e2s, s2s...)로 직접 형변환 매칭
            const mappedType = mapRelationType(rel);

            // 매칭된 대상 작업 ID가 미존재, 혹은 매핑 실패 타입이 나오면 링크 렌더링 무효(스킵) 처리
            if (!predId || !mappedType) return [];
            // 자기 자신 코드를 타겟으로 잡아서 무한 루프 화살표를 생성하는 논리적 버그(Circle logic) 강제 차단 제어
            if (predId === row.id) return [];

            return [{
                // 고유한 문자열 조합을 통해 링크 아이디(ID)를 발급하여 다중 생성을 시도해도 중복 렌더링 버그 이슈 보장 및 방지 유도
                id: `${predId}-${row.id}-${mappedType}-${lag}-${i}`,
                source: predId,     // 선행작업 대상 (선이 출발하는 방향 영역)
                target: row.id,     // 현재 자기자신의 작업 식별키 (선이 도착하는 종점역)
                type: mappedType,   // 간트 네이티브 연결 방향 특성 (SVAR 내부 형식 전용 e2s, s2s 지정어)
                lag: lag,           // 추가 혹은 마이너스 할당량으로서 계산되는 의도적 작업 공백 시간 치수
            }];
        });
    });

    return { tasks, links };
}
