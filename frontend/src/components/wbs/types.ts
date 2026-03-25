// 업로드 후 화면 상단에 표시할 요약 정보
export interface SummaryInfo {
    createdNodeCount: number;    // createdNodeCount: 실제 트리 노드로 생성된 개수
    ignoredDetailRows: number;  // ignoredDetailRows: WBS Lv가 "내역"이어서 무시된 행 개수
}

// 엑셀 원본을 읽어서 "트리 구조"로 바꾼 중간 단계 데이터
export interface NodeTreeItem {
    internalId: number; // internalId: 시스템 내부에서 사용하는 고유 id
    level: number;   // 현재 노드의 WBS 레벨
    parentInternalId: number | null;    // 부모 노드의 internalId 루트라면 null
    wbsLevel: number;   // 엑셀에 있던 WBS Lv 값
    wbsCode: string;    // 엑셀의 WBS Code
    workName: string;   // 엑셀의 공종명

    // 금액 정보들
    totalAmount: number;
    materialAmount: number;
    laborAmount: number;
    expenseAmount: number;
    // 관련 일정 정보 (엑셀에서 바로 읽은 값, string 위주)
    durationDays: string | null; // 엑셀의 기간 컨텐츠 원본 문자열
    predecessorCode: string;
    relationType: string;
    lag: string;
    duration: string; // 기간 컨텀츠 카피 (혼용 방지를 위한 별도 필드)

    // 자식 노드 배열
    children: NodeTreeItem[];
}

// 관계유형은 선택 가능한 값이 정해져 있다.
// 이런 식으로 문자열 리터럴 유니온 타입을 만들면
// 잘못된 문자열 입력을 컴파일 단계에서 막을 수 있다.
export type RelationType = "" | "FS" | "FF" | "SS" | "SF";

// 실제 화면의 왼쪽 TreeGrid에서 한 행(row)을 표현하는 타입
export interface EditableWbsRow {
    id: number;
    parentId: number;

    // 현재 행의 들여쓰기 레벨
    level: number;

    // 원본 트리 기준으로 자식이 있는지
    hasChildren: boolean;

    // 현재 왼쪽 트리에서 펼쳐져 있는지
    open: boolean;

    // 표시 정보
    workName: string;
    wbsCode: string;

    // 금액
    totalAmount: number;
    materialAmount: number;
    laborAmount: number;
    expenseAmount: number;

    // 사용자가 입력하는 일정 정보
    startDate: string;
    endDate: string;
    durationDays: string | null;
    duration: string;

    // 선행작업 / 관계유형 / Lag
    predecessorCode: string;
    relationType: string;
    lag: string;


    // CPM 계산 결과 (CPM 계산 버튼 클릭 후 채워짐)
    es?: number;
    ef?: number;
    ls?: number;
    lf?: number;
    tf?: number;
    ff?: number;
    isCritical?: boolean;
}

export interface GanttTaskItem {
    // 오른쪽 Gantt 컴포넌트에 넘길 task 형식
    // SVAR Gantt가 이해할 수 있는 형태로 만든다.

    id: number;
    parent?: number;
    open: boolean;

    // 간트에 표시될 작업명
    text: string;

    // 시작일 / 종료일
    start: Date;
    end: Date;
    duration?: number;

    // summary: 자식이 있는 그룹 작업
    // task: 일반 작업
    type: "summary" | "task";

    // 커스텀 필드 (내장 그리드에서 사용)
    wbsCode?: string;
    totalAmount?: number;
    materialAmount?: number;
    laborAmount?: number;
    expenseAmount?: number;
    startDate?: string;
    endDate?: string;
    durationDays?: number | null;
    predecessorCode?: string;
    relationType?: string;
    lag?: string | number;

    // CPM 결과
    es?: number;
    ef?: number;
    ls?: number;
    lf?: number;
    tf?: number;
    ff?: number;
    isCritical?: boolean;
}

export interface GanttLinkItem {
    // 간트의 링크(선행/후행 관계)를 표현하는 타입
    id: string;
    source: number;
    target: number;

    // SVAR Gantt가 이해하는 링크 타입
    // e2s = end-to-start = FS
    // e2e = end-to-end = FF
    // s2s = start-to-start = SS
    // s2e = start-to-end = SF
    type: "e2s" | "e2e" | "s2s" | "s2e";

    lag?: number;
}

// 엑셀을 sheet_to_json(header:1)로 읽으면
// "2차원 배열" 형태가 된다.
// 각 셀에는 문자열/숫자/boolean/null 등이 들어올 수 있다.
export type ExcelCell = string | number | boolean | null | undefined;
export type ExcelRow = ExcelCell[];
