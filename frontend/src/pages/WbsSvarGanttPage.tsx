import {useMemo} from "react";
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

export default function WbsSvarGanttPage() {
    const state = useGanttState();

    useGanttEvents(
        state.api,
        state.setRows,
        state.rebuildFromRows,
        state.changeZoomBy
    );

    // ganttScales를 따로 넘기면 zoom 설정과 역할이 겹칠 수 있으므로 zoomConfig를 기준으로만 스케일을 제어
    const { baseColumns } = useGanttColumns(state.applyDateChange);

    const activeColumns = useMemo(() => {
        return state.columnConfig
            .filter((c) => c.visible)
            .map((c) => baseColumns.find((bc) => bc.id === c.id))
            .filter(Boolean);
    }, [state.columnConfig, baseColumns]);

    return (
        <>
            <GanttHeader
                onFileUpload={state.handleFileUpload}
                summary={state.summary}
                totalRowsCount={state.rows.length}
                onColumnSettingsClick={() => state.setShowColumnPopup(true)}
                onSizeSettingsClick={() => state.setShowSizeSettings(true)}
                onCpmCalculationClick={state.handleCpmCalculation}
                isCpmDisabled={state.rows.length === 0}
                cpmError={state.cpmError}
            />

            <Willow>
                <Gantt
                    init={state.setApi}
                    tasks={state.ganttData.tasks}
                    links={state.ganttData.links}
                    columns={activeColumns}
                    start={state.calendarRange.start}
                    end={state.calendarRange.end}
                    zoom={state.zoomConfig}
                    cellWidth={state.sizeSettings.cellWidth}
                    cellHeight={state.sizeSettings.cellHeight}
                    scaleHeight={state.sizeSettings.scaleHeight}
                />
            </Willow>

            {state.api && (
                <CustomTaskEditor
                    api={state.api}
                    rows={state.rows}
                    onUpdateRow={state.handleUpdateRow}
                />
            )}

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
        </>
    );
}