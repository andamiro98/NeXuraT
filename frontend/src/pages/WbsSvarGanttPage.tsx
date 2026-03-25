import React, { useMemo, useState, useEffect, useCallback } from "react";
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
import { calculateCpm } from "../components/wbs/pdmUtils";
import type { EditableWbsRow, SummaryInfo, RelationType } from "../components/wbs/types";
import GanttSizeSettingsPanel, { type GanttSizeSettings } from "./GanttSizeSettingsPanel.tsx";

// Gantt zoom prop 타입 추출
// Gantt의 zoom prop은 boolean | IZoomConfig | undefined 형태일 수 있다.
// 여기서는 실제 설정 객체 타입만 쓰기 위해 boolean / undefined를 제외한다.
type GanttZoomConfig = Exclude<NonNullable<React.ComponentProps<typeof Gantt>["zoom"]>, boolean>;

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
            {val === 0 || val === "0" ? formatMoney(val) : val ? formatMoney(val) : "-"}
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
function toOptionalDateInputValue(value: unknown): string {
    if (value == null || value === "") return "";

    if (typeof value === "string" || value instanceof Date) {
        return toDateInputValue(value);
    }

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

// localStorage 안전 접근 함수
// SSR / 테스트 환경에서는 window 또는 localStorage가 없을 수 있으므로
// 직접 접근하지 않고 이 함수를 통해 읽고 쓴다.
function safeGetLocalStorage(key: string): string | null {
    try {
        if (typeof window === "undefined") return null;
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSetLocalStorage(key: string, value: string): void {
    try {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(key, value);
    } catch {
        // 저장 실패는 치명적이지 않으므로 조용히 무시
    }
}

const DEFAULT_SIZE_SETTINGS: GanttSizeSettings = {
    cellWidth: 100,
    cellHeight: 38,
    scaleHeight: 36,
};

// scale에서 주말 셀에 CSS 클래스를 주기 위한 함수
const weekendCss = (date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 6 ? "sday" : "";
};


// 숫자를 2자리 문자열로 맞춰주는 함수
// 예: 3 -> "03", 11 -> "11"
const pad2 = (value: number): string => String(value).padStart(2, "0");

// 상단/하단 스케일에 표시할 날짜 문자열 포맷 함수들
// 문자열 포맷("yyyy", "MMMM yyyy" 등)이 현재 SVAR Gantt 버전에서
// 해석되지 않고 그대로 출력될 수 있어서,
// 함수로 직접 표시 문자열을 만들어 반환하는 방식으로 처리한다.

// 연도 표시: 2026년
const formatYear = (date: Date): string => {
    return `${date.getFullYear()}년`;
};

// 분기 표시: 1분기, 2분기 ...
const formatQuarter = (date: Date): string => {
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    return `${quarter}분기`;
};

// 연-월 표시: 2026년 03월
const formatYearMonth = (date: Date): string => {
    return `${date.getFullYear()}년 ${pad2(date.getMonth() + 1)}월`;
};

// 월만 표시: 03월
const formatMonth = (date: Date): string => {
    return `${pad2(date.getMonth() + 1)}월`;
};

// 일 표시: 01일, 02일 ...
const formatDay = (date: Date): string => {
    return `${pad2(date.getDate())}일`;
};

// 시간 표시: 06:00, 13:00
const formatHourMinute = (date: Date): string => {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

// 주차 계산 함수
// "몇 번째 주"인지 대략적으로 계산해서 "3주차" 같은 형태로 반환한다.
// ISO 주차와 완전히 동일한 엄밀 계산이 필요하면 별도 로직으로 바꿀 수 있지만,
// 현재는 간트 헤더 표시용으로 이해하기 쉬운 형태를 우선 사용한다.
const formatWeek = (date: Date): string => {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const diffDays = Math.floor((date.getTime() - firstDay.getTime()) / 86400000);
    const week = Math.floor(diffDays / 7) + 1;
    return `${week}주차`;
};

// 줌 설정 생성 함수
// level: 현재 기본으로 선택되는 zoom 단계 index
// minCellWidth / maxCellWidth: 전체 zoom 동작 범위
// levels: 각 zoom 단계별로 어떤 단위(연/월/주/일/시간)로 표시할지 정의
const createInitialZoomConfig = (): GanttZoomConfig => ({
    level: 4,
    minCellWidth: 50,
    maxCellWidth: 300,
    levels: [
        {
            // 연 단위만 크게 보는 단계
            minCellWidth: 200,
            maxCellWidth: 400,
            scales: [
                { unit: "year", step: 1, format: formatYear },
            ],
        },
        {
            // 연 + 분기 단계
            minCellWidth: 150,
            maxCellWidth: 400,
            scales: [
                { unit: "year", step: 1, format: formatYear },
                { unit: "quarter", step: 1, format: formatQuarter },
            ],
        },
        {
            // 분기 + 월 단계
            minCellWidth: 250,
            maxCellWidth: 350,
            scales: [
                { unit: "quarter", step: 1, format: formatQuarter },
                { unit: "month", step: 1, format: formatYearMonth },
            ],
        },
        {
            // 월 + 주 단계
            minCellWidth: 100,
            maxCellWidth: 220,
            scales: [
                { unit: "month", step: 1, format: formatYearMonth },
                { unit: "week", step: 1, format: formatWeek },
            ],
        },
        {
            // 월 + 일 단계
            // 현재 화면에서 가장 자주 보게 될 가능성이 높은 구간
            minCellWidth: 100,
            maxCellWidth: 200,
            scales: [
                { unit: "month", step: 1, format: formatMonth },
                { unit: "day", step: 1, format: formatDay, css: weekendCss },
            ],
        },
        {
            // 일 + 6시간 단계
            minCellWidth: 25,
            maxCellWidth: 100,
            scales: [
                { unit: "day", step: 1, format: formatDay, css: weekendCss },
                { unit: "hour", step: 6, format: formatHourMinute },
            ],
        },
        {
            // 일 + 1시간 단계
            minCellWidth: 25,
            maxCellWidth: 120,
            scales: [
                { unit: "day", step: 1, format: formatDay, css: weekendCss },
                { unit: "hour", step: 1, format: formatHourMinute },
            ],
        },
    ],
} as GanttZoomConfig);


function collectDescendantIds(targetId: number, sourceRows: EditableWbsRow[]): Set<number> {
    const ids = new Set<number>([targetId]);
    let changed = true;

    while (changed) {
        changed = false;

        for (const row of sourceRows) {
            const parentId = Number(row.parentId ?? 0);
            const rowId = Number(row.id);

            if (ids.has(parentId) && !ids.has(rowId)) {
                ids.add(rowId);
                changed = true;
            }
        }
    }

    return ids;
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
        { id: "totalAmount", header: "합계금액", visible: true },
        { id: "es", header: "ES", visible: false },
        { id: "ef", header: "EF", visible: false },
        { id: "ls", header: "LS", visible: false },
        { id: "lf", header: "LF", visible: false },
        { id: "tf", header: "TF", visible: false },
        { id: "ff", header: "FF", visible: false },
        { id: "isCritical", header: "주공정", visible: false },
    ]);

    const [showSizeSettings, setShowSizeSettings] = useState(false);

    const [sizeSettings, setSizeSettings] = useState<GanttSizeSettings>(() => {
        const saved = safeGetLocalStorage("wbs-gantt-size-settings");

        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                return DEFAULT_SIZE_SETTINGS;
            }
        }

        return DEFAULT_SIZE_SETTINGS;
    });

    // zoomLevel:
    // - 현재 활성화된 zoom 단계 숫자만 저장한다.
    // - 전체 zoom 설정 객체(levels, scales, css 함수)는 코드 안의 템플릿을 그대로 사용한다.
    // - localStorage에는 숫자 level만 저장해서 함수(css)가 JSON 직렬화 과정에서 사라지는 문제를 피한다.
    const [zoomLevel, setZoomLevel] = useState<number>(() => {
        const saved = safeGetLocalStorage("wbs-gantt-zoom-level");
        const parsed = saved ? Number(saved) : 4;
        return Number.isFinite(parsed) ? parsed : 4;
    });

    // 셀 크기 설정 저장
    useEffect(() => {
        safeSetLocalStorage("wbs-gantt-size-settings", JSON.stringify(sizeSettings));
    }, [sizeSettings]);

    // 현재 zoom level 숫자만 저장
    useEffect(() => {
        safeSetLocalStorage("wbs-gantt-zoom-level", String(zoomLevel));
    }, [zoomLevel]);

    // zoomConfig:
    // - Gantt에 넘길 최종 zoom 설정 객체
    // - createInitialZoomConfig()가 level별 scales와 css 함수를 포함한 템플릿을 만든다.
    // - 현재 선택된 zoomLevel 숫자만 덮어써서 사용
    const zoomConfig = useMemo<GanttZoomConfig>(() => {
        return {
            ...createInitialZoomConfig(),
            level: zoomLevel,
        };
    }, [zoomLevel]);

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
                const nextRows = prev.map((row) => {
                    if (row.id !== rowId) return row;

                    const nextRow: EditableWbsRow = {
                        ...row,
                        [field]: rawValue,
                    };

                    const nextDuration = hasBothDates(nextRow.startDate, nextRow.endDate)
                        ? computeDurationDays(nextRow.startDate, nextRow.endDate)
                        : null;

                    nextRow.durationDays = nextDuration != null ? String(nextDuration) : null;

                    return nextRow;
                });

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
            const result = evt.target?.result;

            if (!(result instanceof ArrayBuffer)) {
                console.error("Excel Parsing Error", new Error("Failed to read file as ArrayBuffer"));
                return;
            }

            const data = new Uint8Array(result);
            const wb = XLSX.read(data, { type: "array" });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1 });

            try {
                const headerIdx = findHeaderRowIndex(sheetData as any[]);

                if (headerIdx !== -1) {
                    const headers = buildMergedHeaders(sheetData[headerIdx] as any, sheetData[headerIdx + 1] as any);
                    const cols = resolveColumnIndexes(headers);
                    const { roots, createdNodeCount, ignoredDetailRows } = buildNodeTree(sheetData as any[], cols);

                    const newRows: EditableWbsRow[] = flattenTreeToEditableRows(roots).map(
                        (row): EditableWbsRow => {
                            const startDate = toDateInputValue(row.startDate);
                            const endDate = toDateInputValue(row.endDate);

                            // 엑셀에 기간(duration) 값이 있으면 그것을 우선 사용
                            // 없을 때만 착수일/종료일로 계산. 결과는 항상 string | null.
                            const rawDur = row.durationDays;
                            const computed = computeDurationDays(startDate, endDate);
                            const durationDays: string | null =
                                rawDur != null && rawDur !== ""
                                    ? String(rawDur)
                                    : computed != null
                                        ? String(computed)
                                        : null;

                            return {
                                ...row,
                                startDate,
                                endDate,
                                durationDays,

                                // rows 전체 타입을 문자열 기준으로 맞춤
                                duration: row.duration != null ? String(row.duration) : "",
                                lag: row.lag != null ? String(row.lag) : "",
                            };
                        }
                    );

                    setRows(newRows);
                    setSummary({ createdNodeCount, ignoredDetailRows });
                    rebuildFromRows(newRows);
                }
            } catch (err) {
                console.error("Excel Parsing Error", err);
            }
        };

        reader.readAsArrayBuffer(file);
    };

    // 현재 rows를 기준으로 차트 시작일 / 종료일 범위를 계산
    const calendarRange = useMemo(() => getCalendarRangeFromRows(rows), [rows]);

    // scale format 콜백 인자를 Date 객체로 정리
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

    // Svar 내장 트리 그리드 커스텀 컬럼 정의
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
                    value={toOptionalDateInputValue(row.startDate ?? row.start)}
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
                    value={toOptionalDateInputValue(row.endDate ?? row.end)}
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
        { id: "totalAmount", header: "합계금액", width: 100, cell: ({ row }: any) => <MoneyCell val={row.totalAmount} /> },
        { id: "es", header: "ES", width: 60, align: "center", cell: ({ row }: any) => row.es != null ? row.es : "-" },
        { id: "ef", header: "EF", width: 60, align: "center", cell: ({ row }: any) => row.ef != null ? row.ef : "-" },
        { id: "ls", header: "LS", width: 60, align: "center", cell: ({ row }: any) => row.ls != null ? row.ls : "-" },
        { id: "lf", header: "LF", width: 60, align: "center", cell: ({ row }: any) => row.lf != null ? row.lf : "-" },
        { id: "tf", header: "TF", width: 60, align: "center", cell: ({ row }: any) => row.tf != null ? row.tf : "-" },
        { id: "ff", header: "FF", width: 60, align: "center", cell: ({ row }: any) => row.ff != null ? row.ff : "-" },
        {
            id: "isCritical", header: "주공정", width: 80, align: "center",
            cell: ({ row }: any) => (
                row.isCritical == null ? "-" :
                    <span style={{ fontWeight: "bold", color: row.isCritical ? "#ef4444" : "#6b7280" }}>
                        {row.isCritical ? "Y" : "N"}
                    </span>
            )
        },
    ], [applyDateChange]);

    const activeColumns = useMemo(() => {
        return columnConfig
            .filter(c => c.visible)
            .map(c => baseColumns.find(bc => bc.id === c.id))
            .filter(Boolean);
    }, [columnConfig, baseColumns]);

    const [cpmError, setCpmError] = useState<string | null>(null);

    const handleCpmCalculation = useCallback(() => {
        if (rows.length === 0) return;
        setCpmError(null);
        try {
            const calculated = calculateCpm(rows);
            const nextRows = rebuildFromRows(calculated);
            setRows(nextRows);

            // Auto-show CPM columns on first run
            setColumnConfig(prev => prev.map(c => {
                if (["es", "ef", "ls", "lf", "tf", "ff", "isCritical"].includes(c.id)) {
                    return { ...c, visible: true };
                }
                return c;
            }));
        } catch (err: any) {
            setCpmError(err.message ?? "CPM 계산 중 오류가 발생했습니다.");
        }
    }, [rows, rebuildFromRows]);

    const handleAddTask = () => {
        if (!api) return;
        const selected = api.getState().selected;

        const payload: any = {
            task: {
                id: Date.now(),
                text: "새 공종",
                start: new Date(),
                end: new Date(),
                duration: 1,
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

    const handleDeleteTask = () => {
        if (!api) return;
        const selected = api.getState().selected;
        if (selected) {
            selected.forEach((id: number | string) => api.exec("delete-task", { id }));
        }
    };

    useEffect(() => {
        if (!api) return;

        const handleUpdate = (ev: any) => {
            const { id, task, inProgress } = ev;
            if (inProgress || !task) return;

            setRows((prev) => {
                const newRows = prev.map((row) => {
                    if (row.id !== id) return row;

                    const nextRow: EditableWbsRow = { ...row };

                    const nextStartDate = task.start !== undefined
                        ? toOptionalDateInputValue(task.start)
                        : row.startDate;
                    const nextEndDate = task.end !== undefined
                        ? toOptionalDateInputValue(task.end)
                        : row.endDate;

                    nextRow.startDate = nextStartDate;
                    nextRow.endDate = nextEndDate;
                    const nextDuration = hasBothDates(nextRow.startDate, nextRow.endDate)
                        ? computeDurationDays(nextRow.startDate, nextRow.endDate)
                        : null;

                    nextRow.durationDays = nextDuration != null ? String(nextDuration) : null;

                    if (task.text !== undefined) nextRow.workName = String(task.text ?? "");
                    if (task.predecessorCode !== undefined) nextRow.predecessorCode = String(task.predecessorCode ?? "").trim();
                    if (task.relationType !== undefined) nextRow.relationType = normalizeRelationType(task.relationType);
                    if (task.lag !== undefined) nextRow.lag = String(task.lag) || "";

                    return nextRow;
                });

                return rebuildFromRows(newRows);
            });
        };

        const handleAdd = (ev: any) => {
            const task = ev?.task;
            if (!task || task.id == null) return;

            setRows((prev) => {
                const taskId = Number(task.id);
                if (!Number.isFinite(taskId)) return prev;
                if (prev.some((row) => Number(row.id) === taskId)) return prev;

                const startDate = toOptionalDateInputValue(task.start ?? new Date());
                const endDate = toOptionalDateInputValue(task.end ?? task.start ?? new Date());
                const parentId = task.parent != null && task.parent !== "" ? Number(task.parent) : 0;

                const newRow: EditableWbsRow = {
                    id: taskId,
                    parentId: Number.isFinite(parentId) ? parentId : 0,
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
                        ? String(computeDurationDays(startDate, endDate))
                        : null,
                    duration: String(task.duration ?? ""),
                    predecessorCode: String(task.predecessorCode ?? ""),
                    relationType: normalizeRelationType(task.relationType),
                    lag: String(task.lag) || "",
                };

                return rebuildFromRows([...prev, newRow]);
            });
        };

        const handleDelete = (ev: any) => {
            const id = ev?.id;
            if (id == null) return;

            setRows((prev) => {
                const numericId = Number(id);
                if (!Number.isFinite(numericId)) return prev;

                const deleteIds = collectDescendantIds(numericId, prev);
                const nextRows = prev.filter((row) => !deleteIds.has(Number(row.id)));
                return rebuildFromRows(nextRows);
            });
        };

        const handleZoom = (ev: any) => {
            const nextLevel = Number(ev?.level);
            if (!Number.isFinite(nextLevel)) return;
            setZoomLevel(nextLevel);
        };

        api.on("update-task", handleUpdate);
        api.on("add-task", handleAdd);
        api.on("delete-task", handleDelete);
        api.on("zoom-scale", handleZoom);

        return () => {
            if (typeof api.off === "function") {
                api.off("update-task", handleUpdate);
                api.off("add-task", handleAdd);
                api.off("delete-task", handleDelete);
                api.off("zoom-scale", handleZoom);
            } else if (typeof api.detach === "function") {
                api.detach("update-task", handleUpdate);
                api.detach("add-task", handleAdd);
                api.detach("delete-task", handleDelete);
                api.detach("zoom-scale", handleZoom);
            }
        };
    }, [api, rebuildFromRows]);

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "#f9fafb" }}>
            <div style={{ padding: "16px 24px", backgroundColor: "#fff", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                    <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", margin: 0 }}>Gantt Chart (SVAR Native)</h2>
                    <input
                        type="file"
                        accept=".xlsx, .xls, .xlsm"
                        onChange={handleFileUpload}
                        style={{ border: "1px solid #d1d5db", borderRadius: "4px", padding: "4px" }}
                    />
                    {summary.createdNodeCount > 0 && (
                        <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                            생성된 공종 수: {summary.createdNodeCount}
                        </span>
                    )}
                </div>
                <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                        전체 항목 수: {rows.length}
                    </span>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button onClick={() => setShowColumnPopup(true)} style={{ padding: "8px 16px", backgroundColor: "#10b981", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                            ⚙ 컬럼 설정
                        </button>
                        <button onClick={() => setShowSizeSettings(true)} style={{ padding: "8px 16px", backgroundColor: "#0ea5e9", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                            ↔ 차트 크기/줌 설정
                        </button>
                        <button
                            onClick={handleCpmCalculation}
                            disabled={rows.length === 0}
                            style={{ padding: "8px 16px", backgroundColor: rows.length === 0 ? "#9ca3af" : "#7c3aed", color: "#fff", border: "none", borderRadius: "4px", cursor: rows.length === 0 ? "not-allowed" : "pointer", fontWeight: "bold" }}
                        >
                            📊 CPM 계산
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

            {cpmError && (
                <div style={{ padding: "8px 24px", backgroundColor: "#fef2f2", borderBottom: "1px solid #fca5a5", color: "#dc2626", fontSize: "0.875rem" }}>
                    ⚠️ CPM 계산 오류: {cpmError}
                </div>
            )}

            <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
                <div style={{ display: "flex", height: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid #e5e7eb", background: "#fff" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Willow>
                            <Gantt
                                // init: Gantt 생성 후 API 객체를 setApi에 저장
                                init={setApi}

                                // 렌더링 데이터
                                tasks={ganttData.tasks}
                                links={ganttData.links}

                                // 왼쪽 grid 컬럼
                                columns={activeColumns}

                                // 기본 scale (헤더 표시용)
                                scales={ganttScales}

                                // 차트 시작/종료 범위
                                start={calendarRange.start}
                                end={calendarRange.end}

                                // zoom 설정 전체를 상태값으로 전달 (사용자가 Ctrl + wheel로 바꾼 level이 그대로 유지)
                                zoom={zoomConfig}

                                // 셀 크기 / 헤더 높이 설정
                                cellWidth={sizeSettings.cellWidth}
                                cellHeight={sizeSettings.cellHeight}
                                scaleHeight={sizeSettings.scaleHeight}
                            />
                        </Willow>
                    </div>

                    {/* 우측 상세 편집기 api가 준비된 뒤에만 렌더링 */}
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

            {showSizeSettings && (
                <GanttSizeSettingsPanel
                    value={sizeSettings}
                    onApply={(nextValue) => {
                        setSizeSettings(nextValue);
                    }}
                    onReset={() => {
                        setSizeSettings(DEFAULT_SIZE_SETTINGS);
                        setZoomLevel(4);
                    }}
                    onClose={() => setShowSizeSettings(false)}
                />
            )}
        </div>
    );
}
