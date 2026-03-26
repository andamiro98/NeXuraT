import { useState, useMemo, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import type { EditableWbsRow, SummaryInfo } from "../../types";
import type { ColumnConfig } from "../../ColumnSettingsPopup";
import type { GanttSizeSettings } from "../../../../pages/GanttSizeSettingsPanel";
import { DEFAULT_SIZE_SETTINGS } from "../constants";
import { safeGetLocalStorage, safeSetLocalStorage, toOptionalDateInputValue, hasBothDates, hasValidDate } from "../utils/helpers";
import { createInitialZoomConfig, type GanttZoomConfig } from "../utils/zoomConfig";
import { buildScheduledGanttData, computeDurationDays, computeGanttDurationDays, getCalendarRangeFromRows, toDateInputValue } from "../../scheduleUtils";
import { findHeaderRowIndex, buildMergedHeaders, resolveColumnIndexes, buildNodeTree, flattenTreeToEditableRows } from "../../excelUtils";
import { calculateCpm } from "../../pdmUtils";

export function useGanttState() {
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
            try { return JSON.parse(saved); } catch { return DEFAULT_SIZE_SETTINGS; }
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

    useEffect(() => {
        safeSetLocalStorage("wbs-gantt-size-settings", JSON.stringify(sizeSettings));
    }, [sizeSettings]);

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
        const rowMap = new Map(nextRows.map((row) => [String(row.id), row]));

        // 3. task를 원본 row 기준으로 다시 정리
        const normalizedTasks = tasks.map((task: any) => {
            const sourceRow = rowMap.get(String(task.id));
            if (!sourceRow) return task;

            const startDate = toOptionalDateInputValue(sourceRow.startDate);
            const endDate = toOptionalDateInputValue(sourceRow.endDate);
            const hasDates = hasBothDates(startDate, endDate);

            return {
                ...task,
                start: hasDates ? startDate : undefined,
                end: hasDates ? endDate : undefined,
                startDate,
                endDate,
                duration: hasDates ? computeGanttDurationDays(startDate, endDate) ?? 0 : 0,
            };
        });

        // 4. 실제 날짜가 모두 있는 task id만 추출
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
        setGanttData({ tasks: normalizedTasks, links: visibleLinks });
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
                    const nextRow: EditableWbsRow = { ...row, [field]: rawValue };
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
            if (!(result instanceof ArrayBuffer)) return;

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
                            const rawDur = row.durationDays;
                            const computed = computeDurationDays(startDate, endDate);
                            const durationDays: string | null =
                                rawDur != null && rawDur !== ""
                                    ? String(rawDur)
                                    : computed != null ? String(computed) : null;

                            return {
                                ...row, startDate, endDate, durationDays,
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

    const [cpmError, setCpmError] = useState<string | null>(null);

    const handleCpmCalculation = useCallback(() => {
        if (rows.length === 0) return;
        setCpmError(null);
        try {
            const calculated = calculateCpm(rows);
            const nextRows = rebuildFromRows(calculated);
            setRows(nextRows);

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

    return {
        rows, setRows,
        summary, setSummary,
        api, setApi,
        ganttData, setGanttData,
        showColumnPopup, setShowColumnPopup,
        columnConfig, setColumnConfig,
        showSizeSettings, setShowSizeSettings,
        sizeSettings, setSizeSettings,
        zoomLevel, setZoomLevel,
        zoomConfig,
        rebuildFromRows,
        applyDateChange,
        handleUpdateRow,
        handleFileUpload,
        calendarRange,
        cpmError, setCpmError,
        handleCpmCalculation
    };
}
