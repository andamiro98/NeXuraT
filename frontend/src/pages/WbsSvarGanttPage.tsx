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

export default function WbsSvarGanttPage() {
    const state = useGanttState();
    const { setLevelFilter } = state;

    useGanttEvents(
        state.api,
        state.setRows,
        state.rebuildFromRows,
        state.changeZoomBy
    );

    const { baseColumns } = useGanttColumns(state.applyDateChange);

    const activeColumns = useMemo(() => {
        return state.columnConfig
            .filter((c) => c.visible)
            .map((c) => baseColumns.find((bc) => bc.id === c.id))
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