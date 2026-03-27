import type { EditableWbsRow, ExcelRow, NodeTreeItem } from "./types";

// 헤더 텍스트 정규화 함수
// 엑셀 헤더는 공백, 줄바꿈, 보이지 않는 띄어쓰기 등이 섞일 수 있다.
// 그래서 비교 전에 텍스트를 통일해줘야 한다.
export function normalizeHeaderText(value: unknown): string {
    return String(value ?? "")
        .replace(/\n/g, " ") // 줄바꿈 제거
        .replace(/\s+/g, "") // 모든 공백 제거
        .trim();             // 앞뒤 공백 제거
}

// 일반 텍스트 정리 함수
// WBS Code, 공종명 같은 값을 깔끔하게 다듬는다.
export function cleanText(value: unknown): string {
    return String(value ?? "")
        .replace(/^'+/, "")   // 엑셀에서 앞에 붙는 작은따옴표 제거
        .replace(/\s+/g, " ") // 연속 공백을 한 칸으로
        .trim();
}

// 숫자 변환 함수
// 금액 컬럼은 "1,234" 같은 문자열일 수도 있고 숫자일 수도 있다.
// 이걸 안전하게 number로 바꿔준다.
export function toNumber(value: unknown): number {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return value;

    const parsed = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
}

// 화면 표시용 금액 포맷
export function formatMoney(value: unknown): string {
    return new Intl.NumberFormat("ko-KR").format(toNumber(value));
}

// 엑셀 전체 행들 중에서 "WBS Lv"가 들어있는 헤더 행을 찾는다.
// 업로드 파일마다 맨 위에 제목행, 공백행 등이 있을 수 있어서
// 헤더가 반드시 0번째 줄에 있다는 보장이 없다.
export function findHeaderRowIndex(rows: ExcelRow[]): number {
    return rows.findIndex((row) =>
        row.some((cell) => normalizeHeaderText(cell) === "WBSLv")
    );
}

// 헤더가 2줄인 엑셀을 하나의 컬럼명 배열로 병합한다.
// 예시:
// 상단: [합계, "", 재료비, ""]
// 하단: [단가, 금액, 단가, 금액]
// 결과: [합계단가, 합계금액, 재료비단가, 재료비금액]
export function buildMergedHeaders(
    topHeaderRow: ExcelRow,
    bottomHeaderRow: ExcelRow
): string[] {
    const length = Math.max(topHeaderRow.length, bottomHeaderRow.length);
    const mergedHeaders: string[] = [];
    let currentGroup = "";

    for (let i = 0; i < length; i += 1) {
        const top = normalizeHeaderText(topHeaderRow[i]);
        const bottom = normalizeHeaderText(bottomHeaderRow[i]);

        // 상단 헤더가 있으면 현재 그룹명 갱신
        if (top) currentGroup = top;

        // 둘 다 비어있으면 빈 컬럼
        if (!top && !bottom) {
            mergedHeaders.push("");
            continue;
        }

        // 하단 헤더가 있으면 상단 그룹명과 결합
        if (bottom) {
            mergedHeaders.push(normalizeHeaderText(`${currentGroup}${bottom}`));
        } else {
            // 하단이 없으면 상단 또는 현재 그룹 사용
            mergedHeaders.push(top || currentGroup);
        }
    }

    return mergedHeaders;
}

// 병합된 헤더 배열에서 필요한 컬럼의 위치(index)를 찾는다.
export function resolveColumnIndexes(headers: string[]) {
    const findIndex = (...candidates: string[]): number =>
        headers.findIndex((header) => candidates.includes(header));

    const columnIndexes = {
        wbsLevel: findIndex("WBSLv"),
        wbsCode: findIndex("WBSCode"),
        workName: findIndex("공종명"),
        totalAmount: findIndex("합계금액"),
        materialAmount: findIndex("재료비금액"),
        laborAmount: findIndex("노무비금액"),
        expenseAmount: findIndex("경비금액"),
        // 추가(PDM 로직 테스트)
        predecessorCode: findIndex("선행작업"),
        lag: findIndex("간격"),
        relationType: findIndex("관계유형"),
        duration: findIndex("기간"),

        // 내역(Detail)용 추가 필드
        // 엑셀의 헤더 텍스트를 기반으로 실제 데이터가 위치한 열 번호를 찾습니다.
        spec: findIndex("규격", "품명/규격"),
        quantity: findIndex("수량"),
        unit: findIndex("단위"),
        totalUnitPrice: findIndex("합계단가", "단가"),
        totalAmountDetail: findIndex("합계금액", "금액"),
        materialUnitPrice: findIndex("재료비단가"),
        materialAmountDetail: findIndex("재료비금액"),
        laborUnitPrice: findIndex("노무비단가"),
        laborAmountDetail: findIndex("노무비금액"),
        expenseUnitPrice: findIndex("경비단가"),
        expenseAmountDetail: findIndex("경비금액"),
        remark: findIndex("비고"),
    };

    // 필수 컬럼이 없으면 즉시 에러를 발생시킨다.
    // 에러를 빨리 내야 이후 로직에서 더 큰 문제를 막을 수 있다.
    // 단, 선행작업/관계유형/간격/기간 같은 선택 컬럼은 없어도 괜찮다.
    const requiredColumnKeys = ["wbsLevel", "wbsCode", "workName"];
    const missingColumns = Object.entries(columnIndexes)
        .filter(([key, index]) => index === -1 && requiredColumnKeys.includes(key))
        .map(([key]) => key);

    if (missingColumns.length > 0) {
        throw new Error(
            `필수 컬럼을 찾지 못했습니다: ${missingColumns.join(", ")}`
        );
    }

    return columnIndexes;
}

// 엑셀 행들을 실제 트리 구조(NodeTreeItem[])로 변환한다.
// 이 함수가 WBS Lv 기반 트리 생성의 핵심이다.
export function buildNodeTree(
    rows: ExcelRow[],
    columnIndexes: ReturnType<typeof resolveColumnIndexes>
) {
    const roots: NodeTreeItem[] = [];

    // stack은 "현재 레벨별 마지막 노드"를 기억하는 배열이다.
    // 예: stack[0] = 현재 레벨1 노드, stack[1] = 현재 레벨2 노드 ...
    const stack: NodeTreeItem[] = [];

    let ignoredDetailRows = 0;
    let createdNodeCount = 0;
    let sequence = 1;

    rows.forEach((row) => {
        const rawLevel = row[columnIndexes.wbsLevel];

        if (rawLevel === null || rawLevel === undefined || rawLevel === "") return;

        const levelText = String(rawLevel).trim();

        // 사용자가 요구한 로직:
        // WBS Lv가 "내역"이면 가장 최근 부모(스택의 마지막 노드)의 detailItems에 추가
        // 스택(stack)은 부모-자식 계층을 추적하는 배열이며, 여기서 방금 전까지 처리된 일반 WBS 아이템을 꺼냅니다.
        if (levelText === "내역") {
            const parentNode = stack[stack.length - 1]; // 일반적으로 내역 바로 위의 WBS 아이템
            if (parentNode) {
                if (!parentNode.detailItems) parentNode.detailItems = [];
                parentNode.detailItems.push({
                    wbsCode: cleanText(row[columnIndexes.wbsCode]),
                    workName: cleanText(row[columnIndexes.workName]),
                    spec: cleanText(row[columnIndexes.spec]),
                    quantity: toNumber(row[columnIndexes.quantity]),
                    unit: cleanText(row[columnIndexes.unit]),
                    totalUnitPrice: toNumber(row[columnIndexes.totalUnitPrice]),
                    totalAmount: toNumber(row[columnIndexes.totalAmountDetail]),
                    materialUnitPrice: toNumber(row[columnIndexes.materialUnitPrice]),
                    materialAmount: toNumber(row[columnIndexes.materialAmountDetail]),
                    laborUnitPrice: toNumber(row[columnIndexes.laborUnitPrice]),
                    laborAmount: toNumber(row[columnIndexes.laborAmountDetail]),
                    expenseUnitPrice: toNumber(row[columnIndexes.expenseUnitPrice]),
                    expenseAmount: toNumber(row[columnIndexes.expenseAmountDetail]),
                    remark: cleanText(row[columnIndexes.remark]),
                });
            } else {
                ignoredDetailRows += 1;
            }
            return;
        }

        const level = Number(rawLevel);
        if (!Number.isFinite(level)) return;

        const node: NodeTreeItem = {
            internalId: sequence++,
            level,
            parentInternalId: null,
            wbsLevel: level,
            wbsCode: cleanText(row[columnIndexes.wbsCode]),
            workName: cleanText(row[columnIndexes.workName]),
            totalAmount: toNumber(row[columnIndexes.totalAmount]),
            materialAmount: toNumber(row[columnIndexes.materialAmount]),
            laborAmount: toNumber(row[columnIndexes.laborAmount]),
            expenseAmount: toNumber(row[columnIndexes.expenseAmount]),
            children: [],

            // 추가(PDM 로직 테스트)
            predecessorCode: cleanText(row[columnIndexes.predecessorCode]),
            lag: cleanText(row[columnIndexes.lag]),
            relationType: cleanText(row[columnIndexes.relationType]),
            duration: cleanText(row[columnIndexes.duration]),
            durationDays: cleanText(row[columnIndexes.duration]) || null,
        };

        // level 1이면 루트 노드
        if (level === 1) {
            roots.push(node);
            stack[0] = node;
            stack.length = 1;
        } else {
            // 현재 레벨이 3이면 부모는 레벨 2
            // 배열 인덱스는 0부터 시작하므로 level-2
            const parent = stack[level - 2];

            if (parent) {
                node.parentInternalId = parent.internalId;
                parent.children.push(node);
            } else {
                // 부모가 없는 이상한 데이터라도 버리지 않고 루트로 보존
                roots.push(node);
            }

            stack[level - 1] = node;
            stack.length = level;
        }

        createdNodeCount += 1;
    });

    return {
        roots,
        createdNodeCount,
        ignoredDetailRows,
    };
}

// 트리 구조를 "화면용 1차원 행 배열"로 펼친다.
// UI 테이블은 보통 트리 구조가 아니라 1줄씩 렌더하므로 flatten 작업이 필요하다.
export function flattenTreeToEditableRows(roots: NodeTreeItem[]): EditableWbsRow[] {
    const result: EditableWbsRow[] = [];

    function walk(node: NodeTreeItem, parentId = 0): void {
        const hasChildren = node.children.length > 0;

        result.push({
            id: node.internalId,
            parentId,
            level: node.level,
            hasChildren,
            open: hasChildren,

            workName: node.workName || "(공종명 없음)",
            wbsCode: node.wbsCode,

            totalAmount: node.totalAmount,
            materialAmount: node.materialAmount,
            laborAmount: node.laborAmount,
            expenseAmount: node.expenseAmount,

            startDate: `${new Date().getFullYear()}-01-01`,
            endDate: `${new Date().getFullYear()}-01-01`,
            // durationDays: null,

            durationDays: node.duration || null,
            duration: node.duration,
            predecessorCode: node.predecessorCode,
            relationType: node.relationType,
            lag: node.lag,

            detailItems: node.detailItems,
        });

        // DFS(깊이 우선 탐색) 방식으로 자식들을 순서대로 펼친다.
        node.children.forEach((child) => walk(child, node.internalId));
    }

    roots.forEach((root) => walk(root, 0));
    return result;
}