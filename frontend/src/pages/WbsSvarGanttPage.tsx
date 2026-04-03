import { useMemo, useCallback } from "react";
import { Gantt, Willow } from "@svar-ui/react-gantt";
import "@svar-ui/react-gantt/all.css";

import ColumnSettingsPopup from "../components/wbs/ColumnSettingsPopup";
import CustomTaskEditor from "../components/wbs/CustomTaskEditor";
import GanttSizeSettingsPanel from "./GanttSizeSettingsPanel";
import GanttHeader from "../components/wbs/gantt/components/GanttHeader";
import { useGanttState } from "../components/wbs/gantt/hooks/useGanttState";
import { useGanttEvents } from "../components/wbs/gantt/hooks/useGanttEvents";
import { useGanttColumns } from "../components/wbs/gantt/hooks/useGanttColumns";
import { DEFAULT_SIZE_SETTINGS } from "../components/wbs/gantt/constants";
// import IfcViewerPanel from "../components/viewer/components/IfcViewerPanel.tsx";
import IfcServerViewer from "../components/viewer/components/IfcServerViewer.tsx";

export default function WbsSvarGanttPage() {
    /**
     * [ useGanttState 훅의 주요 반환 상태 및 제어 요소들 ]
     * rows                 - 엑셀 row 데이터 (화면 편집 기준 원본 행 데이터)
     * summary              - 엑셀 파싱 후 상단에 보여줄 요약 수치 : createdNodeCount: 생성된 공종(노드) 수, ignoredDetailRows: 트리 생성 과정에서 무시된 "상세(내역)" 행 수
     * api                  - SVAR Gantt에서 init 콜백을 통해 전달되는 API
     * columnConfig         - 좌측 그리드에 표시할 컬럼 목록의 순서와 표시 여부를 관리하는 설정 배열
     * applyDateChange      - 일자 속성(착수일/종료일 등) 값이 변경되었을 때 내부 데이터 업데이트 처리를 수행하는 함수
     * ganttData            - SVAR 간트 차트에 렌더링하기 위한 원본 데이터 (tasks, links 속성 포함)
     * filteredGanttData    - levelFilter(레벨 필터)에 의해 필터링이 적용된 화면에 보여질 최종 간트 차트 데이터
     * showColumnPopup      - 그리드 컬럼 가시성 설정 팝업창의 표시(열림) 기동 상태
     * showSizeSettings     - 차트 크기(셀 너비/높이 등) 제어 패널의 활성화 열림 상태
     * sizeSettings         - 로컬 스토리지와 연동되어 유지되는 간트 차트의 세부 표시 크기 설정 객체
     * zoomLevel            - 현재 적용 중인 차트의 확대/축소(zoom) 스케일 수치 수준
     * zoomConfig           - SVAR 간트 차트 컴포넌트에 넘겨질 템플릿과 zoomLevel을 혼합한 최종 줌 설정 객체
     * calendarRange        - 현재 화면 차트에 렌더링 될 타임라인 날짜 범위 (start, end)
     * levelFilter          - 특정한 WBS 공종 단계만 화면에 표시하기 위해 다중 선택된 레벨 번호들(Set)
     * cpmError             - CPM(주공정망) 분석 및 일정 스케줄 계산 시 발생한 예외 에러 메시지
     */
    const state = useGanttState();
    const { setLevelFilter } = state;   // 객체구조분해할당

    useGanttEvents(
        state.api,
        state.setRows,
        state.rebuildFromRows,
        state.changeZoomBy,
        state.setColumnConfig // 간트 트리그리드 사용자가 컬럼 넓이를 조절할 때 이를 앱 상태에 저장하기 위한 Setter 함수를 이벤트 훅으로 넘겨줌
    );

    const { baseColumns } = useGanttColumns(state.applyDateChange);

    const activeColumns = useMemo(() => {
        return state.columnConfig
            .filter((c) => c.visible) // 표시 여부가 체크된 유효한 컬럼만 조회
            .map((c) => {
                const bc = baseColumns.find((bc) => bc.id === c.id); // 훅에서 제공하는 원본 컬럼 구성 객체 검색
                if (!bc) return null;
                // state.columnConfig 내부에 사용자가 간트 리사이져로 저장해 둔 고유 width가 존재한다면 우선적으로 적용하여, 기본(초기) 넓이로 돌아가는 덮어씌움 현상을 수비
                return { ...bc, width: c.width ?? bc.width };
            })
            .filter(Boolean);
    }, [state.columnConfig, baseColumns]);

    const handleLevelFilterChange = useCallback((level: number) => {
        setLevelFilter((prev) => {
            const next = new Set(prev);
            if (next.has(level)) {
                next.delete(level);
            } else {
                next.add(level);
            }
            return next;
        });
    }, [setLevelFilter]);

    const handleLevelFilterReset = useCallback(() => {
        setLevelFilter(new Set());
    }, [setLevelFilter]);

    return (
        <div style={{ width: "100%", height: "100vh" }}>
            <Willow>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "row",
                        width: "100%",
                        height: "100%",
                    }}
                >
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <IfcServerViewer height={460} />

                        <GanttHeader
                            onFileUpload={state.handleFileUpload}
                            summary={state.summary}
                            totalRowsCount={state.rows.length}
                            onColumnSettingsClick={() => state.setShowColumnPopup(true)}
                            onSizeSettingsClick={() => state.setShowSizeSettings(true)}
                            onCpmCalculationClick={state.handleCpmCalculation}
                            isCpmDisabled={state.rows.length === 0}
                            cpmError={state.cpmError}
                            availableLevels={state.availableLevels}
                            levelFilter={state.levelFilter}
                            onLevelFilterChange={handleLevelFilterChange}
                            onLevelFilterReset={handleLevelFilterReset}
                        />

                       {/* <IfcViewer />*/}

                        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                            <Gantt
                                key={Array.from(state.levelFilter).sort().join(",")}
                                init={state.setApi}
                                tasks={state.filteredGanttData.tasks}
                                links={state.filteredGanttData.links}
                                columns={activeColumns}
                                start={state.calendarRange.start}
                                end={state.calendarRange.end}
                                zoom={state.zoomConfig}
                                cellWidth={state.sizeSettings.cellWidth}
                                cellHeight={state.sizeSettings.cellHeight}
                                scaleHeight={state.sizeSettings.scaleHeight}
                            />
                        </div>
                    </div>

                    {state.api && (
                        <CustomTaskEditor
                            api={state.api}
                            rows={state.rows}
                            onUpdateRow={state.handleUpdateRow}
                        />
                    )}
                </div>

                {state.showColumnPopup && (
                    <ColumnSettingsPopup
                        columns={state.columnConfig}
                        onApply={(newConfig) => {
                            state.setColumnConfig(newConfig);
                            state.setShowColumnPopup(false);
                        }}
                        onClose={() => state.setShowColumnPopup(false)}
                    />
                )}

                {state.showSizeSettings && (
                    <GanttSizeSettingsPanel
                        value={state.sizeSettings}
                        onApply={state.setSizeSettings}
                        onReset={() => {
                            state.setSizeSettings(DEFAULT_SIZE_SETTINGS);
                            state.resetZoom();
                        }}
                        onClose={() => state.setShowSizeSettings(false)}
                    />
                )}
            </Willow>
        </div>
    );
}
