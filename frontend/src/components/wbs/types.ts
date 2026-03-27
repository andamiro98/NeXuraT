// 업로드 후 화면 상단에 표시할 요약 정보
export interface SummaryInfo {
    createdNodeCount: number;    // createdNodeCount: 실제 트리 노드로 생성된 개수
    ignoredDetailRows: number;  // ignoredDetailRows: WBS Lv가 "내역"이어서 무시된 행 개수
}

// 내역 (Detail / Level 7 Child Items) 데이터
// 엑셀에서 '내역'에 해당하는 한 줄의 데이터를 통째로 담을 수 있는 인터페이스입니다.
export interface WbsDetailItem {
    wbsCode: string;            // 엑셀에서 추출한 해당 내역의 식별 대상 WBS 코드
    workName: string;           // 개별 내역 항목의 구체적인 작업명(공종) 또는 품명
    spec: string;               // 자재나 품목의 기술적 상세 규격이나 모델명
    quantity: number;           // 해당 내역에 투입되는 예상 총 수량(물량)
    unit: string;               // 수량의 크기를 재는 측정 단위 (예: EA, M2, TON 등)

    totalUnitPrice: number;     // 수량 1개당 발생하는 전체 합계 단가
    totalAmount: number;        // (합계 단가 * 수량)으로 산출된 총 합계 금액
    materialUnitPrice: number;  // 수량 1개당 발생하는 재료비 단가 부분
    materialAmount: number;     // 전체 물량에 대한 총 재료비 투입 금액
    laborUnitPrice: number;     // 수량 1개당 발생하는 노무비 단가 부분
    laborAmount: number;        // 전체 물량에 대한 총 인건비(노무비) 수준 금액
    expenseUnitPrice: number;   // 수량 1개당 발생하는 기타 경비 단가 부분
    expenseAmount: number;      // 전체 물량에 대한 총 기타 부대 경비 금액

    remark: string;             // 추가적인 참고 사항, 특기 사항이나 작업 메모(비고란 내용)
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
    startDate?: string | null; // 엑셀 지정 착수일
    endDate?: string | null; // 엑셀 지정 종료일
    durationDays: string | null; // 엑셀의 기간 컨텐츠 원본 문자열
    predecessorCode: string;
    relationType: string;
    lag: string;
    duration: string; // 기간 컨텀츠 카피 (혼용 방지를 위한 별도 필드)

    // 자식 노드 배열
    children: NodeTreeItem[];

    // 내역들
    // 어떤 WBS 항목(주로 7레벨)이 자신의 하위 내역 아이템들을 배열 형태로 보관합니다.
    detailItems?: WbsDetailItem[];
}

// 관계유형은 선택 가능한 값이 정해져 있다.
// 이런 식으로 문자열 리터럴 유니온 타입을 만들면
// 잘못된 문자열 입력을 컴파일 단계에서 막을 수 있다.
export type RelationType = "" | "FS" | "FF" | "SS" | "SF";

// 실제 화면의 왼쪽 TreeGrid에서 한 행(row)을 표현하는 타입
export interface EditableWbsRow {
    id: number; // 시스템 내에서 현재 행(row)을 식별하는 고유 ID 번호
    parentId: number; // 상위(부모)가 되는 행의 고유 ID (최상위 항목일 경우 주로 0)

    // 현재 행의 들여쓰기 레벨
    level: number; // 트리 구조상 현재 항목이 몇 단계 깊이(들여쓰기)에 있는지 나타내는 수치

    // 원본 트리 기준으로 자식이 있는지
    hasChildren: boolean; // 이 항목 산하에 하위 작업(자식) 항목들이 존재하는지를 나타내는 플래그

    // 현재 왼쪽 트리에서 펼쳐져 있는지
    open: boolean; // 트리그리드 화면에서 해당 항목의 하위 리스트를 펼쳐서(Open) 보여줄지 여부

    // 표시 정보
    workName: string; // 화면에 주로 노출되는 텍스트로, 수행할 공종(작업)의 명칭
    wbsCode: string; // 대상 식별에 주로 쓰이는 프로젝트 관리용 WBS 코드 번호

    // 금액
    totalAmount: number; // 노무비, 재료비, 경비 등이 합산된 당해 항목의 총 합계 금액
    materialAmount: number; // 원자재, 소모품 등 재료 구매에 소요되는 금액 범위
    laborAmount: number; // 인건비 명목으로 산정된 노무비 측면의 할당 금액
    expenseAmount: number; // 그 외 부수적으로 발생된 기계 장비, 운영비 등의 추가 경비

    // 사용자가 입력하는 일정 정보
    startDate: string; // 화면 또는 달력 모듈에서 제어를 위해 사용되는 문자열형 시작 날짜(YYYY-MM-DD)
    endDate: string; // 화면 또는 달력 모듈에서 제어를 위해 사용되는 문자열형 종료 날짜(YYYY-MM-DD)
    durationDays: string | null; // 일정 연산을 거쳐 추산된 후 활용되는 소요 일수 (숫자로 변환될 수 있는 문자열)
    duration: string; // 엑셀을 통해 임포트 시 받아온 순수 텍스트 형식의 기간 수치 원본

    // 선행작업 / 관계유형 / Lag
    predecessorCode: string; // 스케줄 제약이 걸린 경우 참조되는 먼저 이루어져야 할 선행작업의 고유 코드
    relationType: string; // 선행작업 대비 어떠한 선/후 연결성을 가지는지 나타내는 형태(FS, SS, SF, FF)
    lag: string; // 선행작업 완료~본 작업 시작 등 기준 시점에 의도적으로 가하는 대기 및 연기 시간(Lag)


    // CPM 계산 결과 (CPM 계산 버튼 클릭 후 채워짐)
    es?: number;
    ef?: number;
    ls?: number;
    lf?: number;
    tf?: number;
    ff?: number;
    isCritical?: boolean;

    detailItems?: WbsDetailItem[];
}

export interface GanttTaskItem {
    // 오른쪽 Gantt 컴포넌트에 넘길 task 형식
    // SVAR Gantt가 이해할 수 있는 형태로 만든다.

    id: number; // 간트 차트 및 시스템 내부에서 해당 작업을 식별하기 위한 고유 번호
    parent?: number; // 상위(부모) 그룹 작업의 ID (부모가 없는 최상단 작업일 경우 생략됨)
    open: boolean; // 화면 렌더링 시 하위 작업들을 기본적으로 펼쳐서 보여줄지 여부

    // 간트에 표시될 작업명
    text: string; // 차트 막대 옆에 또는 트리그리드에 텍스트로 표시될 공종명(이름)

    // 시작일 / 종료일
    start: Date; // 실제 차트에 막대가 그려질 착수일 기준 (JS Date 타입 객체 형식)
    end: Date; // 실제 차트 막대가 그려지는 마지막 종료일 기준 (JS Date 형식)
    duration?: number; // 착수일부터 종료일까지 산출된 총 예상 소요 시간 (일 단위 숫자)

    // summary: 자식이 있는 그룹 작업
    // task: 일반 작업
    type: "summary" | "task"; // 작업의 성격 분류 구분자 (summary: 폴더 역할, task: 실제 스케줄 태스크)

    // 커스텀 필드 (내장 그리드에서 사용)
    wbsCode?: string; // 트리그리드에 텍스트 형태로 노출할 대상 작업의 WBS 코드 번호
    totalAmount?: number; // 팝업 등에서 조회할 상세 합산 자금 (총 금액)
    materialAmount?: number; // 전체 비용 중 구성되는 재료비 순수 금액
    laborAmount?: number; // 전체 비용 중 투입 인력 등에 배정된 노무비 금액
    expenseAmount?: number; // 시스템 이용료나 장비대 같은 부대 경비 할당량
    startDate?: string; // 캘린더 피커 등에서 수정 가능하도록 화면에 보여지는 문자열 형태 시작일 (예: "2024-05-12")
    endDate?: string; // 에디터 등에서 문자열 폼 형태로 제어할 때 참조되는 종료 날짜 (YYYY-MM-DD)
    durationDays?: number | null; // 영업일이나 주말 배제 로직 등이 가미된 순수 소요 일수 연산 결과값
    predecessorCode?: string; // 현재 작업을 착수하기에 앞서 완료나 착수 조건이 걸린 선행 작업의 명칭(코드)
    relationType?: string; // 두 작업 간의 선후 연결 고리 형태 패턴 (FS: Finish-Start, SS: Start-Start 등)
    lag?: string | number; // 선행작업의 종료/시작 기점으로부터 현재 작업 시작 전까지 의도적으로 두는 대기 시간(Lag)

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
