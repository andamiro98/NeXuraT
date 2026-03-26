import { useMemo } from "react";
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

    useGanttEvents(state.api, state.setRows, state.rebuildFromRows, state.setZoomLevel);

    const { baseColumns, ganttScales } = useGanttColumns(state.applyDateChange);

    const activeColumns = useMemo(() => {
        return state.columnConfig
            .filter(c => c.visible)
            .map(c => baseColumns.find(bc => bc.id === c.id))
            .filter(Boolean);
    }, [state.columnConfig, baseColumns]);

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "#f9fafb" }}>
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

            <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
                <div style={{ display: "flex", height: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid #e5e7eb", background: "#fff" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Willow>
                            <Gantt
                                init={state.setApi}
                                tasks={state.ganttData.tasks}
                                links={state.ganttData.links}
                                columns={activeColumns}
                                scales={ganttScales}
                                start={state.calendarRange.start}
                                end={state.calendarRange.end}
                                zoom={state.zoomConfig}
                                cellWidth={state.sizeSettings.cellWidth}
                                cellHeight={state.sizeSettings.cellHeight}
                                scaleHeight={state.sizeSettings.scaleHeight}
                            />
                        </Willow>
                    </div>

                    {state.api && <CustomTaskEditor api={state.api} rows={state.rows} onUpdateRow={state.handleUpdateRow} />}
                </div>
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
                        state.setZoomLevel(4);
                    }}
                    onClose={() => state.setShowSizeSettings(false)}
                />
            )}
        </div>
    );
}
