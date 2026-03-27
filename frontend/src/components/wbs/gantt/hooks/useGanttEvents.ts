import { useEffect } from "react";
import type { EditableWbsRow } from "../../types";
import {
    toOptionalDateInputValue,
    hasBothDates,
    normalizeRelationType
} from "../utils/helpers";
import { computeDurationDays } from "../../scheduleUtils";

export function useGanttEvents(
    api: any,
    setRows: React.Dispatch<React.SetStateAction<EditableWbsRow[]>>,
    rebuildFromRows: (nextRows: EditableWbsRow[]) => EditableWbsRow[],
    changeZoomBy: (dir: number) => void
) {
    useEffect(() => {
        if (!api) return;

        const handleUpdate = (ev: any) => {
            const { id, task, inProgress } = ev;
            if (inProgress || !task) return;

            setRows((prev) => {
                const newRows = prev.map((row) => {
                    if (row.id !== id) return row;

                    const nextRow: EditableWbsRow = { ...row };

                    const nextStartDate =
                        task.start !== undefined
                            ? toOptionalDateInputValue(task.start)
                            : row.startDate;

                    const nextEndDate =
                        task.end !== undefined
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

        // zoom-scale 이벤트에서는 절대 rows / calendarRange를 건드리지 않고 zoom 방향값만 반영
        const handleZoom = (ev: any) => {
            const dir = Number(ev?.dir);
            if (!Number.isFinite(dir)) return;
            changeZoomBy(dir);
        };

        // 행 재정렬(세로 드래그)만 차단
        const blockRowReorder = (ev: any) => {
            if (typeof ev?.top !== "undefined") {
                return false;
            }
        };

        api.on("update-task", handleUpdate);
        api.on("zoom-scale", handleZoom);
        api.intercept("drag-task", blockRowReorder);

        return () => {
            if (typeof api.off === "function") {
                api.off("update-task", handleUpdate);
                api.off("zoom-scale", handleZoom);
            } else if (typeof api.detach === "function") {
                api.detach("update-task", handleUpdate);
                api.detach("zoom-scale", handleZoom);
            }

            // intercept 해제
            if (typeof api.detach === "function") {
                api.detach("drag-task", blockRowReorder);
            } else if (typeof api.off === "function") {
                api.off("drag-task", blockRowReorder);
            }
        };
    }, [api, setRows, rebuildFromRows, changeZoomBy]);
}