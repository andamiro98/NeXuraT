import { useEffect } from "react";
import type { EditableWbsRow } from "../../types";
import { toOptionalDateInputValue, hasBothDates, normalizeRelationType, collectDescendantIds } from "../utils/helpers";
import { computeDurationDays } from "../../scheduleUtils";

export function useGanttEvents(
    api: any,
    setRows: React.Dispatch<React.SetStateAction<EditableWbsRow[]>>,
    rebuildFromRows: (nextRows: EditableWbsRow[]) => EditableWbsRow[],
    setZoomLevel: (level: number) => void
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
    }, [api, setRows, rebuildFromRows, setZoomLevel]);
}
