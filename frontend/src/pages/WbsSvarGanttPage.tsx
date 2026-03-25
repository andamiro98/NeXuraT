import { useMemo, useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { Gantt, Willow } from "@svar-ui/react-gantt";
import "@svar-ui/react-gantt/all.css";

import ColumnSettingsPopup, { type ColumnConfig } from "../components/wbs/ColumnSettingsPopup";
import CustomTaskEditor from "../components/wbs/CustomTaskEditor";

import {
    findHeaderRowIndex,
    buildMergedHeaders,
    resolveColumnIndexes,
    buildNodeTree,
    flattenTreeToEditableRows
} from "../components/wbs/excelUtils";
import {
    buildScheduledGanttData,
    computeDurationDays,
    formatMoney,
    getCalendarRangeFromRows,
    toDateInputValue,
} from "../components/wbs/scheduleUtils";
import type { EditableWbsRow, SummaryInfo, RelationType } from "../components/wbs/types";

// 금액 셀 전용 렌더러
// val:
// - 숫자 또는 숫자 문자열이 들어올 수 있음
// - 값이 없으면 "-"를 표시
// formatMoney:
// - 숫자를 천 단위 구분기호가 포함된 문자열로 변환
// 이 컴포넌트는 재료비 / 노무비 / 경비 / 합계금액 컬럼에서 공통으로 사용된다.
const MoneyCell = ({ val }: { val: any }) => {
    return (
        <div
            style={{
                padding: "0 8px",
                width: "100%",
                textAlign: "right",
                color: "#6b7280"
            }}
        >
            {val ? formatMoney(val) : "-"}
        </div>
    );
};

// 날짜 input 공통 스타일
// 착수일 / 종료일 컬럼에서 동일한 UI를 유지하기 위해 별도 상수로 분리한다.
// width: 셀 폭에 맞춰 가득 차게 표시
// height: 표 안에서 높이를 일정하게 맞춤
// border / borderRadius: 기본 입력창 형태 지정
// padding: 좌우 내부 여백
// boxSizing: padding, border를 포함한 실제 크기 계산 방식
const DATE_INPUT_STYLE: React.CSSProperties = {
    width: "100%",
    height: 30,
    border: "1px solid #d1d5db",
    borderRadius: 4,
    padding: "0 8px",
    background: "#fff",
    boxSizing: "border-box",
    fontSize: 13,
};

// 관계유형 정규화 함수
// value는 엑셀, 사용자 편집, gantt 내부 이벤트에서 들어오므로 타입이 일정하지 않다.
// RelationType으로 허용하는 값은 "FS" | "FF" | "SS" | "SF" | "" 이다.
// 허용 목록에 없는 값은 빈 문자열로 정리해서 상태를 일관되게 유지한다.
function normalizeRelationType(value: unknown): RelationType {
    // FS: Finish to Start
    // FF: Finish to Finish
    // SS: Start to Start
    // SF: Start to Finish
    if (value === "FS" || value === "FF" || value === "SS" || value === "SF") {
        return value;
    }

    // 잘못된 문자열, null, undefined, 숫자, 객체 등은 모두 빈 값 처리
    return "";
}

// 날짜 input 값 정규화 함수
// HTML <input type="date">의 value는 보통 "YYYY-MM-DD" 형식 문자열을 기대한다.
// 이 함수는 들어오는 값을 안전하게 점검한 뒤, 날짜로 쓸 수 있으면 문자열로 변환하고
// 날짜로 쓸 수 없으면 빈 문자열("")을 돌려준다.
//
// 처리 대상 예시
// - "2026-03-01"  -> "2026-03-01"
// - Date 객체      -> "2026-03-01"
// - null          -> ""
// - undefined     -> ""
// - {}            -> ""
// - []            -> ""
function toOptionalDateInputValue(value: unknown): string {
    // null / undefined / ""는 "날짜 미선택 상태"로 본다.
    if (value == null || value === "") return "";

    // 문자열과 Date 객체만 scheduleUtils.toDateInputValue로 넘긴다.
    // 이 단계에서 TypeScript가 value 타입을 string | Date로 좁혀서 안전하게 처리할 수 있다.
    if (typeof value === "string" || value instanceof Date) {
        return toDateInputValue(value);
    }

    // 그 외 타입은 date input 값으로 부적합하므로 빈 문자열 처리
    return "";
}

// 시작일 / 종료일 동시 존재 여부 검사
// 둘 중 하나라도 비어 있으면 false
// 둘 다 값이 있으면 true
// duration 계산과 차트 표시 가능 여부 판단에서 공통으로 사용한다.
function hasBothDates(startDate: unknown, endDate: unknown): boolean {
    return !!startDate && !!endDate;
}

// 날짜 유효성 검사
// value를 Date 생성자에 넣어 파싱한 뒤 getTime() 결과가 NaN인지 확인한다.
// 유효한 날짜면 true, 해석 불가능한 값이면 false
// start / end가 실제 차트 바를 만들 수 있는 값인지 점검할 때 사용한다.
function hasValidDate(value: unknown): boolean {
    if (value == null || value === "") return false;

    const d = new Date(value as any);
    return !Number.isNaN(d.getTime());
}

export default function WbsSvarGanttPage() {
    // rows:
    // - 엑셀에서 읽은 뒤 화면 편집 기준이 되는 원본 행 데이터
    // - 착수일, 종료일, 금액, 선행작업, 관계유형, Lag 같은 값이 들어 있음
    // - CustomTaskEditor와 상단 개수 표시도 이 rows를 기준으로 동작한다.
    const [rows, setRows] = useState<EditableWbsRow[]>([]);

    // summary:
    // - 엑셀 파싱 후 상단에 보여줄 요약 수치
    // - createdNodeCount: 생성된 공종(노드) 수
    // - ignoredDetailRows: 트리 생성 과정에서 무시된 상세 행 수
    const [summary, setSummary] = useState<SummaryInfo>({ createdNodeCount: 0, ignoredDetailRows: 0 });

    // api:
    // - SVAR Gantt에서 init 콜백을 통해 전달되는 API 객체
    // - add-task, delete-task, 선택 상태 조회, 이벤트 연결 등에 사용한다.
    const [api, setApi] = useState<any>(null);

    // ganttData:
    // - Gantt 컴포넌트에 최종 전달할 렌더링용 데이터
    // - tasks: 왼쪽 그리드 + 오른쪽 차트에 공통으로 전달되는 task 배열
    // - links: 선후행 관계선을 그릴 link 배열
    // rows를 직접 넣지 않고 한 번 변환한 구조를 유지한다.
    const [ganttData, setGanttData] = useState<{ tasks: any[]; links: any[] }>({ tasks: [], links: [] });

    // 컬럼 설정 팝업 열림/닫힘 상태
    const [showColumnPopup, setShowColumnPopup] = useState(false);

    // columnConfig:
    // - 왼쪽 그리드에 표시할 컬럼 목록의 순서와 visible 상태를 관리
    // - ColumnSettingsPopup에서 이 값을 수정하면 activeColumns가 다시 계산된다.
    // - id는 baseColumns의 각 컬럼 id와 연결된다.
    const [columnConfig, setColumnConfig] = useState<ColumnConfig[]>(() => [
        { id: "text", header: "공종명", visible: true },
        { id: "wbsCode", header: "WBS Code", visible: true },
        { id: "start", header: "착수일", visible: true },
        { id: "end", header: "종료일", visible: true },
        { id: "duration", header: "기간(일)", visible: true },
        { id: "predecessorCode", header: "선행작업", visible: true },
        { id: "relationType", header: "관계유형", visible: true },
        { id: "lag", header: "간격(Lag)", visible: true },
        { id: "materialAmount", header: "재료비", visible: true },
        { id: "laborAmount", header: "노무비", visible: true },
        { id: "expenseAmount", header: "경비", visible: true },
        { id: "totalAmount", header: "합계금액", visible: true }
    ]);

    // rows -> ganttData 변환 함수
    // nextRows를 받아 task / link를 다시 만든 뒤 setGanttData까지 수행한다.
    // 상태 변경 지점마다 이 함수를 재사용해서 변환 규칙을 한 곳에 모은다.
    const rebuildFromRows = useCallback((nextRows: EditableWbsRow[]) => {
        // 1. scheduleUtils에서 기본 task 배열과 link 배열 생성
        // buildScheduledGanttData는 row 데이터를 gantt 라이브러리 형식으로 1차 변환한다.
        const { tasks, links } = buildScheduledGanttData(nextRows);

        // 2. task.id로 원본 row를 빠르게 찾기 위한 Map 생성
        // String(row.id)로 맞추는 이유는 task.id 타입이 숫자 또는 문자열로 들어올 수 있어서
        // 키 비교 기준을 하나로 통일하기 위해서다.
        const rowMap = new Map(nextRows.map((row) => [String(row.id), row]));

        // 3. task를 원본 row 기준으로 다시 정리
        // - start / end는 원본 row의 startDate / endDate를 우선 사용
        // - 날짜가 둘 다 없으면 차트 바가 생기지 않도록 start / end를 undefined로 둔다.
        // - duration은 날짜가 둘 다 있을 때만 다시 계산한다.
        const normalizedTasks = tasks.map((task: any) => {
            const sourceRow = rowMap.get(String(task.id));

            // 방어 코드:
            // task는 있는데 rowMap에 없으면 원본 값을 그대로 유지
            if (!sourceRow) return task;

            const startDate = toOptionalDateInputValue(sourceRow.startDate);
            const endDate = toOptionalDateInputValue(sourceRow.endDate);
            const hasDates = hasBothDates(startDate, endDate);

            return {
                ...task,

                // 차트 바 시작일
                start: hasDates ? startDate : undefined,

                // 차트 바 종료일
                end: hasDates ? endDate : undefined,

                // grid input 표시와 내부 동기화를 위한 보조 값
                startDate,
                endDate,

                // 기간(일) 값
                duration: hasDates ? computeDurationDays(startDate, endDate) : 0,
            };
        });

        // 4. 실제 날짜가 모두 있는 task id만 추출
        // link는 양 끝 task가 모두 유효한 날짜를 가져야만 표시한다.
        const visibleTaskIds = new Set(
            normalizedTasks
                .filter((task: any) => hasValidDate(task.start) && hasValidDate(task.end))
                .map((task: any) => task.id)
        );

        // 5. 유효한 task끼리 연결된 link만 남김
        const visibleLinks = links.filter((link: any) => {
            return visibleTaskIds.has(link.source) && visibleTaskIds.has(link.target);
        });

        // 6. 최종 ganttData 반영
        setGanttData({
            tasks: normalizedTasks,
            links: visibleLinks,
        });

        // setRows 내부에서 return 값으로 바로 사용할 수 있게 nextRows 자체도 반환
        return nextRows;
    }, []);

    // 날짜 컬럼 input 변경 처리
    // rowId: 수정 대상 행 id
    // field: "startDate" 또는 "endDate"
    // rawValue: input[type="date"]에서 전달되는 값. 비어 있으면 ""
    const applyDateChange = useCallback(
        (rowId: number, field: "startDate" | "endDate", rawValue: string) => {
            setRows((prev) => {
                // 수정 대상 행만 새 객체로 교체하고, 나머지는 기존 객체 유지
                const nextRows = prev.map((row) => {
                    if (row.id !== rowId) return row;

                    const nextRow: EditableWbsRow = {
                        ...row,
                        [field]: rawValue,
                    };

                    // 날짜 두 개가 모두 있는 경우에만 기간 재계산
                    // 하나라도 비어 있으면 기간은 0으로 맞춘다.
                    nextRow.durationDays = hasBothDates(nextRow.startDate, nextRow.endDate)
                        ? computeDurationDays(nextRow.startDate, nextRow.endDate)
                        : 0;

                    return nextRow;
                });

                // rows와 ganttData를 같은 기준으로 함께 갱신
                return rebuildFromRows(nextRows);
            });
        },
        [rebuildFromRows]
    );

    // CustomTaskEditor에서 전달한 수정값 반영
    // id에 해당하는 row를 찾아 updates 내용을 덮어쓴 뒤 ganttData를 다시 계산한다.
    const handleUpdateRow = useCallback((id: number, updates: Partial<EditableWbsRow>) => {
        setRows((prev) => {
            const nextRows = prev.map((row) => (row.id === id ? { ...row, ...updates } : row));
            return rebuildFromRows(nextRows);
        });
    }, [rebuildFromRows]);

    // 엑셀 업로드 처리
    // 파일을 읽고, 시트를 파싱하고, 트리 구조를 만든 다음 rows / summary / ganttData를 갱신한다.
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = (evt) => {
            // FileReader 결과
            const result = evt.target?.result;

            // readAsArrayBuffer로 읽었기 때문에 ArrayBuffer가 아니면 파싱 중단
            if (!(result instanceof ArrayBuffer)) {
                console.error("Excel Parsing Error", new Error("Failed to read file as ArrayBuffer"));
                return;
            }

            // XLSX 라이브러리가 읽기 쉬운 Uint8Array 형태로 변환
            const data = new Uint8Array(result);

            // 워크북 전체 파싱
            const wb = XLSX.read(data, { type: "array" });

            // 첫 번째 시트를 기본 대상 시트로 사용
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];

            // 시트 내용을 2차원 배열로 변환
            // header: 1 -> 각 행을 object가 아닌 배열로 받는다.
            const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1 });

            try {
                // 병합 헤더 구조에서 실제 헤더 시작 행 찾기
                const headerIdx = findHeaderRowIndex(sheetData as any[]);

                if (headerIdx !== -1) {
                    // 2줄 헤더를 합쳐서 최종 헤더 배열 생성
                    const headers = buildMergedHeaders(sheetData[headerIdx] as any, sheetData[headerIdx + 1] as any);

                    // 필요한 컬럼의 인덱스를 헤더명 기준으로 해석
                    const cols = resolveColumnIndexes(headers);

                    // 시트 배열을 트리 노드 구조로 변환
                    // roots: 루트 노드들
                    // createdNodeCount: 생성된 노드 수
                    // ignoredDetailRows: 무시된 상세 행 수
                    const { roots, createdNodeCount, ignoredDetailRows } = buildNodeTree(sheetData as any[], cols);

                    // 트리 구조를 화면 편집용 1차원 배열로 펼침
                    const newRows = flattenTreeToEditableRows(roots).map((row) => {
                        // 엑셀에서 들어온 날짜 값을 input에 넣기 좋은 문자열로 정리
                        const startDate = toOptionalDateInputValue(row.startDate);
                        const endDate = toOptionalDateInputValue(row.endDate);

                        return {
                            ...row,
                            startDate,
                            endDate,

                            // 날짜 두 개가 모두 있을 때만 기간 계산
                            durationDays: hasBothDates(startDate, endDate)
                                ? computeDurationDays(startDate, endDate)
                                : 0,
                        };
                    });

                    // 원본 rows 상태 저장
                    setRows(newRows);

                    // 상단 요약 정보 저장
                    setSummary({ createdNodeCount, ignoredDetailRows });

                    // gantt 렌더링용 구조 재계산
                    rebuildFromRows(newRows);
                }
            } catch (err) {
                console.error("Excel Parsing Error", err);
            }
        };

        reader.readAsArrayBuffer(file);
    };

    // 현재 rows를 기준으로 차트 시작일 / 종료일 범위를 계산
    // rows가 바뀔 때만 다시 계산한다.
    // getCalendarRangeFromRows는 일정 데이터가 없을 때도 기본 범위를 반환할 수 있다.
    const calendarRange = useMemo(() => getCalendarRangeFromRows(rows), [rows]);

    // scale format 콜백 인자를 Date 객체로 정리
    // SVAR scale format에는 Date가 바로 들어올 수도 있고, 다른 타입이 들어올 수도 있다.
    // 1차로 이미 Date인 값을 찾고, 없으면 new Date(...)로 다시 파싱한다.
    // 끝까지 유효한 날짜를 찾지 못하면 null 반환
    const resolveScaleDate = (...args: any[]): Date | null => {
        for (const arg of args) {
            if (arg instanceof Date && !Number.isNaN(arg.getTime())) return arg;
        }

        for (const arg of args) {
            const parsed = new Date(arg);
            if (!Number.isNaN(parsed.getTime())) return parsed;
        }

        return null;
    };

    // ganttScales:
    // - 차트 상단 시간축 표시 방식
    // - 첫 번째 scale: 월 단위
    // - 두 번째 scale: 일 단위
    // useMemo로 고정해서 불필요한 재생성을 막는다.
    const ganttScales = useMemo(() => [
        {
            unit: "month",
            step: 1,
            format: (...args: any[]) => {
                const date = resolveScaleDate(...args);
                if (!date) return "";
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, "0");
                return `${year}년 ${month}월`;
            },
        },
        {
            unit: "day",
            step: 1,
            format: (...args: any[]) => {
                const date = resolveScaleDate(...args);
                if (!date) return "";
                return String(date.getDate());
            },
        }
    ], []);

    // baseColumns:
    // - Gantt 왼쪽 그리드에 표시할 전체 컬럼 정의
    // - columnConfig는 "보일지 / 순서"만 관리하고
    //   실제 렌더링 세부 설정은 여기서 관리한다.
    // - cell 속성은 커스텀 렌더러, editor 속성은 Gantt 내장 편집기 설정이다.
    const baseColumns: any[] = useMemo(() => [
        { id: "text", header: "공종명", width: 250 },
        { id: "wbsCode", header: "WBS Code", width: 100 },
        {
            id: "start",
            header: "착수일",
            width: 132,
            align: "center",
            cell: ({ row }: any) => (
                <input
                    type="date"

                    // row.startDate:
                    // - rows 원본 상태에 저장된 날짜 문자열
                    // row.start:
                    // - gantt task 변환 후 들어온 시작일 값
                    // 둘 중 하나가 있어도 date input에 넣을 수 있는 문자열로 다시 정리한다.
                    value={toOptionalDateInputValue(row.startDate ?? row.start)}

                    // 사용자가 날짜를 바꾸면 rows와 ganttData를 함께 갱신
                    onChange={(e) => applyDateChange(row.id, "startDate", e.target.value)}
                    style={DATE_INPUT_STYLE}
                />
            ),
        },
        {
            id: "end",
            header: "종료일",
            width: 132,
            align: "center",
            cell: ({ row }: any) => (
                <input
                    type="date"

                    // 종료일도 착수일과 동일한 규칙으로 표시
                    value={toOptionalDateInputValue(row.endDate ?? row.end)}

                    // 변경 즉시 해당 row의 endDate와 duration을 갱신
                    onChange={(e) => applyDateChange(row.id, "endDate", e.target.value)}
                    style={DATE_INPUT_STYLE}
                />
            ),
        },
        {
            id: "duration",
            header: "기간(일)",
            width: 80,
            align: "center",
            cell: ({ row }: any) => row.durationDays ?? row.duration ?? "-",
        },
        { id: "predecessorCode", header: "선행작업", width: 90, editor: "text" },
        {
            id: "relationType",
            header: "관계유형",
            width: 90,
            editor: {
                type: "combo",
                config: {
                    options: [
                        { id: "", label: "-" },
                        { id: "FS", label: "FS" },
                        { id: "FF", label: "FF" },
                        { id: "SS", label: "SS" },
                        { id: "SF", label: "SF" }
                    ]
                }
            }
        },
        { id: "lag", header: "간격(Lag)", width: 80, editor: "text" },
        { id: "materialAmount", header: "재료비", width: 100, cell: ({ row }: any) => <MoneyCell val={row.materialAmount} /> },
        { id: "laborAmount", header: "노무비", width: 100, cell: ({ row }: any) => <MoneyCell val={row.laborAmount} /> },
        { id: "expenseAmount", header: "경비", width: 100, cell: ({ row }: any) => <MoneyCell val={row.expenseAmount} /> },
        { id: "totalAmount", header: "합계금액", width: 100, cell: ({ row }: any) => <MoneyCell val={row.totalAmount} /> }
    ], [applyDateChange]);

    // 실제로 Gantt에 전달할 컬럼 배열
    // 처리 순서
    // 1. visible === true 인 설정만 남김
    // 2. 설정 id에 맞는 실제 컬럼 정의를 baseColumns에서 찾음
    // 3. 찾지 못한 값(undefined)은 제거
    // 결과적으로 columnConfig의 순서가 화면 컬럼 순서가 된다.
    const activeColumns = useMemo(() => {
        return columnConfig
            .filter(c => c.visible)
            .map(c => baseColumns.find(bc => bc.id === c.id))
            .filter(Boolean);
    }, [columnConfig, baseColumns]);

    // 새 작업 추가 버튼 처리
    // 현재 선택된 행이 있으면 그 뒤(after)에 추가하고
    // 선택된 행이 없으면 기본 위치에 추가한다.
    // 시작일 / 종료일은 빈 상태로 두어 차트가 자동으로 생기지 않게 한다.
    const handleAddTask = () => {
        if (!api) return;
        const selected = api.getState().selected;

        const payload: any = {
            task: {
                // 임시 id
                // 현재는 Date.now() 기반 숫자를 사용
                id: Date.now(),

                // 기본 작업명
                text: "새 공종",

                // 선행 코드 / 관계유형 / Lag 기본값
                predecessorCode: "",
                relationType: "",
                lag: 0,
            }
        };

        if (selected && selected.length > 0 && selected[0] != null) {
            payload.target = selected[0];
            payload.mode = "after";
        }

        api.exec("add-task", payload);
    };

    // 현재 선택된 작업 삭제
    // api.getState().selected 에 들어 있는 id 목록을 순회하면서 delete-task 실행
    const handleDeleteTask = () => {
        if (!api) return;
        const selected = api.getState().selected;
        if (selected) {
            selected.forEach((id: number | string) => api.exec("delete-task", { id }));
        }
    };

    // Gantt 내부 이벤트와 React 상태 동기화
    // update-task: 드래그, 리사이즈, 인라인 편집 등으로 task가 바뀐 경우
    // add-task: gantt 내부 명령으로 새 task가 생성된 경우
    // delete-task: gantt 내부 명령으로 task가 삭제된 경우
    useEffect(() => {
        if (!api) return;

        const handleUpdate = (ev: any) => {
            const { id, task, inProgress } = ev;

            // 드래그 중간 프레임은 무시하고 최종 확정 시점만 반영
            if (inProgress || !task) return;

            setRows((prev) => {
                const newRows = prev.map((row) => {
                    if (row.id !== id) return row;

                    const nextRow: EditableWbsRow = { ...row };

                    // gantt task.start / task.end를 rows용 날짜 문자열로 정규화
                    const nextStartDate = task.start !== undefined
                        ? toOptionalDateInputValue(task.start)
                        : row.startDate;

                    const nextEndDate = task.end !== undefined
                        ? toOptionalDateInputValue(task.end)
                        : row.endDate;

                    nextRow.startDate = nextStartDate;
                    nextRow.endDate = nextEndDate;

                    // 날짜 두 개가 모두 있을 때만 기간 계산
                    nextRow.durationDays = hasBothDates(nextRow.startDate, nextRow.endDate)
                        ? computeDurationDays(nextRow.startDate, nextRow.endDate)
                        : 0;

                    // task.text -> workName
                    if (task.text !== undefined) nextRow.workName = String(task.text ?? "");

                    // 선행 코드 문자열 정리
                    if (task.predecessorCode !== undefined) {
                        nextRow.predecessorCode = String(task.predecessorCode ?? "").trim();
                    }

                    // 관계유형 정규화
                    if (task.relationType !== undefined) {
                        nextRow.relationType = normalizeRelationType(task.relationType);
                    }

                    // Lag 숫자 변환
                    if (task.lag !== undefined) {
                        nextRow.lag = Number(task.lag) || 0;
                    }

                    return nextRow;
                });

                return rebuildFromRows(newRows);
            });
        };

        const handleAdd = (ev: any) => {
            const task = ev?.task;
            if (!task || task.id == null) return;

            setRows((prev) => {
                // 이미 같은 id가 rows에 있으면 중복 추가 방지
                if (prev.some((row) => row.id === task.id)) return prev;

                const startDate = toOptionalDateInputValue(task.start);
                const endDate = toOptionalDateInputValue(task.end);

                // gantt task를 rows 형식으로 변환
                const newRow: EditableWbsRow = {
                    id: Number(task.id),
                    parentId: task.parent ? Number(task.parent) : 0,
                    level: 0,
                    hasChildren: false,
                    open: true,
                    workName: String(task.text ?? "새 공종"),
                    wbsCode: "",
                    totalAmount: 0,
                    materialAmount: 0,
                    laborAmount: 0,
                    expenseAmount: 0,
                    startDate,
                    endDate,
                    durationDays: hasBothDates(startDate, endDate)
                        ? computeDurationDays(startDate, endDate)
                        : 0,
                    predecessorCode: String(task.predecessorCode ?? ""),
                    relationType: normalizeRelationType(task.relationType),
                    lag: Number(task.lag) || 0,
                };

                return rebuildFromRows([...prev, newRow]);
            });
        };

        const handleDelete = (ev: any) => {
            const id = ev?.id;
            if (id == null) return;

            setRows((prev) => {
                // 현재 구현은
                // - 자기 자신(id === 삭제 id)
                // - 바로 아래 1단계 자식(parentId === 삭제 id)
                // 를 함께 제거한다.
                const nextRows = prev.filter((row) => row.id !== id && row.parentId !== id);
                return rebuildFromRows(nextRows);
            });
        };

        // API 이벤트 연결
        api.on("update-task", handleUpdate);
        api.on("add-task", handleAdd);
        api.on("delete-task", handleDelete);

        // cleanup:
        // api.off가 있으면 off 사용
        // 없고 detach가 있으면 detach 사용
        return () => {
            if (typeof api.off === "function") {
                api.off("update-task", handleUpdate);
                api.off("add-task", handleAdd);
                api.off("delete-task", handleDelete);
            } else if (typeof api.detach === "function") {
                api.detach("update-task", handleUpdate);
                api.detach("add-task", handleAdd);
                api.detach("delete-task", handleDelete);
            }
        };
    }, [api, rebuildFromRows]);

    return (
        // 전체 페이지 레이아웃
        // 상단 툴바 + 본문(Gantt 영역) 구조
        <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "#f9fafb" }}>
            {/* 상단 헤더 / 툴바 */}
            <div style={{ padding: "16px 24px", backgroundColor: "#fff", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {/* 왼쪽: 제목, 파일 업로드, 요약 정보 */}
                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                    <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", margin: 0 }}>Gantt Chart (SVAR Native)</h2>
                    <input
                        type="file"
                        accept=".xlsx, .xls"
                        onChange={handleFileUpload}
                        style={{ border: "1px solid #d1d5db", borderRadius: "4px", padding: "4px" }}
                    />
                    {summary.createdNodeCount > 0 && (
                        <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                            생성된 공종 수: {summary.createdNodeCount}
                        </span>
                    )}
                </div>

                {/* 오른쪽: 전체 개수, 컬럼 설정, 추가/삭제 버튼 */}
                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                    <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                        전체 항목 수: {rows.length}
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={() => setShowColumnPopup(true)} style={{ padding: "8px 16px", backgroundColor: "#10b981", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                            ⚙ 컬럼 설정
                        </button>
                        <button onClick={handleAddTask} style={{ padding: "8px 16px", backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                            + 작업 추가
                        </button>
                        <button onClick={handleDeleteTask} style={{ padding: "8px 16px", backgroundColor: "#ef4444", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                            - 선택 삭제
                        </button>
                    </div>
                </div>
            </div>

            {/* 본문: Gantt + 우측 편집기 */}
            <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
                <div style={{ display: "flex", height: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid #e5e7eb", background: "#fff" }}>
                    {/* 좌측/중앙: SVAR Gantt 본체 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Willow>
                            <Gantt
                                // init:
                                // Gantt 생성 후 API 객체를 setApi에 저장
                                init={setApi}

                                // 렌더링 데이터
                                tasks={ganttData.tasks}
                                links={ganttData.links}

                                // 왼쪽 grid 컬럼
                                columns={activeColumns}

                                // 상단 시간축
                                scales={ganttScales}

                                // 차트 시작/종료 범위
                                start={calendarRange.start}
                                end={calendarRange.end}

                                // 초기 zoom level
                                zoom={{ level: 7 }}
                            />
                        </Willow>
                    </div>

                    {/* 우측 상세 편집기
                        api가 준비된 뒤에만 렌더링 */}
                    {api && <CustomTaskEditor api={api} rows={rows} onUpdateRow={handleUpdateRow} />}
                </div>
            </div>

            {/* 컬럼 설정 팝업 */}
            {showColumnPopup && (
                <ColumnSettingsPopup
                    columns={columnConfig}
                    onApply={(newConfig) => {
                        setColumnConfig(newConfig);
                        setShowColumnPopup(false);
                    }}
                    onClose={() => setShowColumnPopup(false)}
                />
            )}
        </div>
    );
}
