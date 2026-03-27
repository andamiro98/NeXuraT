import { useState, useMemo, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import type { EditableWbsRow, SummaryInfo } from "../../types";
import type { ColumnConfig } from "../../ColumnSettingsPopup";
import type { GanttSizeSettings } from "../../../../pages/GanttSizeSettingsPanel";
import { DEFAULT_SIZE_SETTINGS } from "../constants";
import {
    toOptionalDateInputValue,
    hasBothDates,
    hasValidDate, safeGetLocalStorage, safeSetLocalStorage
} from "../utils/helpers";
import { createInitialZoomConfig, type GanttZoomConfig } from "../utils/zoomConfig";
import {
    buildScheduledGanttData,
    computeDurationDays,
    computeGanttDurationDays,
    getCalendarRange,
    getCalendarRangeFromRows,
    toDateInputValue
} from "../../scheduleUtils";
import {
    findHeaderRowIndex,
    buildMergedHeaders,
    resolveColumnIndexes,
    buildNodeTree,
    flattenTreeToEditableRows
} from "../../excelUtils";
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
    const [summary, setSummary] = useState<SummaryInfo>({
        createdNodeCount: 0,
        ignoredDetailRows: 0
    });

    // api:
    // - SVAR Gantt에서 init 콜백을 통해 전달되는 API 객체
    // - add-task, delete-task, 선택 상태 조회, 이벤트 연결 등에 사용한다.
    const [api, setApi] = useState<any>(null);

    // ganttData:
    // - Gantt 컴포넌트에 최종 전달할 렌더링용 데이터
    // - tasks: 왼쪽 그리드 + 오른쪽 차트에 공통으로 전달되는 task 배열
    // - links: 선후행 관계선을 그릴 link 배열
    // rows를 직접 넣지 않고 한 번 변환한 구조를 유지한다.
    const [ganttData, setGanttData] = useState<{ tasks: any[]; links: any[] }>({
        tasks: [],
        links: []
    });

    const [showColumnPopup, setShowColumnPopup] = useState(false); // 좌측 그리드에 어떤 열(컬럼)들을 띄울지 선택하는 설정 팝업창 활성화 상태

    // columnConfig:
    // - 왼쪽 그리드에 표시할 컬럼 목록의 순서와 visible 상태를 관리
    // - ColumnSettingsPopup에서 이 값을 수정하면 activeColumns가 다시 계산된다.
    // - id는 baseColumns의 각 컬럼 id와 연결된다.
    const [columnConfig, setColumnConfig] = useState<ColumnConfig[]>([
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
        { id: "isCritical", header: "주공정", visible: false }
    ]);

    const [showSizeSettings, setShowSizeSettings] = useState(false); // 간트 차트의 표시 크기(셀 너비/높이 등) 제어 패널의 열림 상태

    const [sizeSettings, setSizeSettings] = useState<GanttSizeSettings>(() => {
        const saved = safeGetLocalStorage("wbs-gantt-size-settings");
        if (saved) {
            try { return JSON.parse(saved); } catch { return DEFAULT_SIZE_SETTINGS; }
        }
        return DEFAULT_SIZE_SETTINGS;
    });

    useEffect(() => {
        safeSetLocalStorage("wbs-gantt-size-settings", JSON.stringify(sizeSettings));
    }, [sizeSettings]);

    // zoomLevel:
    // - 현재 활성화된 zoom 단계 숫자만 저장
    // - 전체 zoom 설정 객체(levels, scales, css 함수)는 코드 안의 템플릿을 그대로 사용
    const zoomTemplate = useMemo(() => createInitialZoomConfig(), []);

    // localStorage 없이 현재 화면 안에서만 zoom 상태를 유지한다.
    const [zoomLevel, setZoomLevel] = useState<number>(zoomTemplate.level ?? 4);

    // Ctrl + wheel 등으로 들어오는 줌 방향값(+ / -)만 받아서
    // level 숫자를 안전한 범위 안에서만 증감시킨다.
    const changeZoomBy = useCallback((dir: number) => {
        const levelsCount = zoomTemplate.levels?.length ?? 1;
        const minLevel = 0;
        const maxLevel = Math.max(levelsCount - 1, 0);

        if (!Number.isFinite(dir) || dir === 0) return;

        setZoomLevel((prev) => {
            const next = prev + (dir > 0 ? 1 : -1);
            return Math.max(minLevel, Math.min(maxLevel, next));
        });
    }, [zoomTemplate]);

    // "차트 크기/줌 설정 초기화" 버튼에서 사용할 기본 zoom 복원 함수
    const resetZoom = useCallback(() => {
        setZoomLevel(zoomTemplate.level ?? 4);
    }, [zoomTemplate]);

    // zoomConfig:
    // - Gantt에 넘길 최종 zoom 설정 객체
    // - createInitialZoomConfig()가 level별 scales와 css 함수를 포함한 템플릿을 만든다.
    // - 현재 선택된 zoomLevel 숫자만 덮어써서 사용
    const zoomConfig = useMemo<GanttZoomConfig>(() => {
        return {
            ...zoomTemplate,
            level: zoomLevel
        };
    }, [zoomTemplate, zoomLevel]);

    // 현재 화면에 보이는 차트 날짜 범위
    // 기존처럼 rows가 바뀔 때마다 자동 재계산하지 않고, 별도 state로 관리
    const [calendarRange, setCalendarRange] = useState<{ start: Date; end: Date }>(() => getCalendarRange());

    // task가 현재 화면 범위를 벗어났을 때만 차트 범위를 넓힌다.
    // 포인트는 "자동 축소하지 않는다"는 점이다.
    // 그래서 task를 옮겨도 사용자가 줌이 바뀐 것처럼 느끼는 현상을 줄일 수 있다.
    const expandCalendarRangeIfNeeded = useCallback((nextRows: EditableWbsRow[]) => {
        const nextRange = getCalendarRangeFromRows(nextRows);

        setCalendarRange((prev) => ({
            start: nextRange.start < prev.start ? nextRange.start : prev.start,
            end: nextRange.end > prev.end ? nextRange.end : prev.end
        }));
    }, []);

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
                duration: hasDates ? computeGanttDurationDays(startDate, endDate) ?? 0 : 0
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

        // rows가 바뀌더라도 화면 범위를 무조건 다시 계산하지 않고, 필요한 경우에만 범위를 넓힌다.
        expandCalendarRangeIfNeeded(nextRows);

        return nextRows;
    }, [expandCalendarRangeIfNeeded]);

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
                    const headers = buildMergedHeaders(
                        sheetData[headerIdx] as any,
                        sheetData[headerIdx + 1] as any
                    );
                    const cols = resolveColumnIndexes(headers);
                    const {
                        roots,
                        createdNodeCount,
                        ignoredDetailRows
                    } = buildNodeTree(sheetData as any[], cols);

                    const newRows: EditableWbsRow[] = flattenTreeToEditableRows(roots).map(
                        (row): EditableWbsRow => {
                            const startDate = toDateInputValue(row.startDate);
                            const endDate = toDateInputValue(row.endDate);
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
                                duration: row.duration != null ? String(row.duration) : "",
                                lag: row.lag != null ? String(row.lag) : ""
                            };
                        }
                    );

                    setRows(newRows);
                    setSummary({ createdNodeCount, ignoredDetailRows });

                    // 파일을 처음 불러올 때는 전체 일정 범위에 맞춰 차트 시작/종료일을 세팅
                    // 이후에는 rebuildFromRows가 "필요할 때만 확장"하도록 동작
                    setCalendarRange(getCalendarRangeFromRows(newRows));

                    rebuildFromRows(newRows);
                }
            } catch (err) {
                console.error("Excel Parsing Error", err);
            }
        };

        reader.readAsArrayBuffer(file);
    };

    // levelFilter:
    // - 현재 선택된 WBS 레벨 필터 (Set<number>)
    // - 비어 있으면 전체 레벨 표시, 값이 있으면 해당 레벨만 표시
    const [levelFilter, setLevelFilter] = useState<Set<number>>(new Set());

    // availableLevels:
    // - rows에서 실제로 존재하는 레벨 번호 목록 (오름차순)
    const availableLevels = useMemo(() => {
        const levels = new Set(rows.map((r) => r.level));
        return Array.from(levels).sort((a, b) => a - b);
    }, [rows]);

    // filteredGanttData:
    // - levelFilter가 비어 있으면 ganttData 그대로 반환
    // - 선택된 레벨이 있으면 해당 레벨의 task만 포함
    //   SVAR Gantt null.forEach 방지 핵심 조건:
    //   1. parent 제거 → 부모 없는 참조 차단
    //   2. type을 "task"로 강제 → "summary" 타입은 SVAR가 자식 배열 탐색을 시도하는데
    //      필터 후 자식이 없으면 null.forEach 발생
    //   3. open: false → 펼쳐진 상태에서 자식 탐색 차단
    const filteredGanttData = useMemo(() => {
        if (levelFilter.size === 0) return ganttData;

        const rowMap = new Map(rows.map((r) => [r.id, r]));

        const filteredTasks = ganttData.tasks
            .filter((task: any) => {
                const row = rowMap.get(task.id);
                if (!row) return false;
                return levelFilter.has(row.level);
            })
            .map((task: any) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { parent: _p, ...rest } = task;
                return {
                    ...rest,
                    type: "task" as const,  // summary → task 강제 (자식 탐색 차단)
                    open: false,             // 펼침 상태 초기화
                };
            });

        const filteredTaskIds = new Set(filteredTasks.map((t: any) => t.id));

        const filteredLinks = ganttData.links.filter((link: any) =>
            filteredTaskIds.has(link.source) && filteredTaskIds.has(link.target)
        );

        return { tasks: filteredTasks, links: filteredLinks };
    }, [ganttData, levelFilter, rows]);

    const [cpmError, setCpmError] = useState<string | null>(null); // CPM(주공정망) 계산 로직 실행 중 발생하는 오류 메시지를 잠시 저장해두는 상태

    const handleCpmCalculation = useCallback(() => {
        if (rows.length === 0) return;

        setCpmError(null);

        try {
            const calculated = calculateCpm(rows);
            const nextRows = rebuildFromRows(calculated);
            setRows(nextRows);

            setColumnConfig((prev) =>
                prev.map((c) => {
                    if (["es", "ef", "ls", "lf", "tf", "ff", "isCritical"].includes(c.id)) {
                        return { ...c, visible: true };
                    }
                    return c;
                })
            );
        } catch (err: any) {
            setCpmError(err.message ?? "CPM 계산 중 오류가 발생했습니다.");
        }
    }, [rows, rebuildFromRows]);

    return {
        rows,
        setRows,
        summary,
        setSummary,
        api,
        setApi,
        ganttData,
        setGanttData,
        showColumnPopup,
        setShowColumnPopup,
        columnConfig,
        setColumnConfig,
        showSizeSettings,
        setShowSizeSettings,
        sizeSettings,
        setSizeSettings,
        zoomLevel,
        setZoomLevel,
        changeZoomBy,
        resetZoom,
        zoomConfig,
        rebuildFromRows,
        applyDateChange,
        handleUpdateRow,
        handleFileUpload,
        calendarRange,
        setCalendarRange,
        cpmError,
        setCpmError,
        handleCpmCalculation,
        levelFilter,
        setLevelFilter,
        availableLevels,
        filteredGanttData
    };
}