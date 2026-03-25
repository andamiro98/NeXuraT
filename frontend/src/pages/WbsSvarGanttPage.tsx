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

const MoneyCell = ({ val }: { val: any }) => {
    return (
        <div style={{ padding: "0 8px", width: "100%", textAlign: "right", color: "#6b7280" }}>
            {val ? formatMoney(val) : "-"}
        </div>
    );
};

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

function normalizeRelationType(value: unknown): RelationType {
    if (value === "FS" || value === "FF" || value === "SS" || value === "SF") {
        return value;
    }
    return "";
}

export default function WbsSvarGanttPage() {
    const [rows, setRows] = useState<EditableWbsRow[]>([]);
    const [summary, setSummary] = useState<SummaryInfo>({ createdNodeCount: 0, ignoredDetailRows: 0 });
    const [api, setApi] = useState<any>(null);

    // SVAR Gantt 컴포넌트에 직접 전달할 데이터 (내부 상태 관리를 위해 별도 분리)
    const [ganttData, setGanttData] = useState<{ tasks: any[]; links: any[] }>({ tasks: [], links: [] });

    const [showColumnPopup, setShowColumnPopup] = useState(false);
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

    const rebuildFromRows = useCallback((nextRows: EditableWbsRow[]) => {
        const { tasks, links } = buildScheduledGanttData(nextRows);
        setGanttData({ tasks, links });
        return nextRows;
    }, []);

    const applyDateChange = useCallback(
        (rowId: number, field: "startDate" | "endDate", rawValue: string) => {
            setRows((prev) => {
                const nextRows = prev.map((row) => {
                    if (row.id !== rowId) return row;

                    const nextRow: EditableWbsRow = {
                        ...row,
                        [field]: rawValue,
                    };

                    nextRow.durationDays = computeDurationDays(nextRow.startDate, nextRow.endDate);
                    return nextRow;
                });

                return rebuildFromRows(nextRows);
            });
        },
        [rebuildFromRows]
    );

    const handleUpdateRow = useCallback((id: number, updates: Partial<EditableWbsRow>) => {
        setRows((prev) => {
            const nextRows = prev.map((row) => (row.id === id ? { ...row, ...updates } : row));
            return rebuildFromRows(nextRows);
        });
    }, [rebuildFromRows]);

    // 엑셀 업로드 처리
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

                    const newRows = flattenTreeToEditableRows(roots).map((row) => ({
                        ...row,
                        startDate: toDateInputValue(row.startDate),
                        endDate: toDateInputValue(row.endDate),
                        durationDays: computeDurationDays(row.startDate, row.endDate),
                    }));
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

    const calendarRange = useMemo(() => getCalendarRangeFromRows(rows), [rows]);

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
                    value={toDateInputValue(row.startDate ?? row.start)}
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
                    value={toDateInputValue(row.endDate ?? row.end)}
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

    const activeColumns = useMemo(() => {
        return columnConfig
            .filter(c => c.visible)
            .map(c => baseColumns.find(bc => bc.id === c.id))
            .filter(Boolean);
    }, [columnConfig, baseColumns]);

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
                        ? toDateInputValue(task.start)
                        : row.startDate;
                    const nextEndDate = task.end !== undefined
                        ? toDateInputValue(task.end)
                        : row.endDate;

                    nextRow.startDate = nextStartDate;
                    nextRow.endDate = nextEndDate;
                    nextRow.durationDays = computeDurationDays(nextStartDate, nextEndDate);

                    if (task.text !== undefined) nextRow.workName = String(task.text ?? "");
                    if (task.predecessorCode !== undefined) nextRow.predecessorCode = String(task.predecessorCode ?? "").trim();
                    if (task.relationType !== undefined) nextRow.relationType = normalizeRelationType(task.relationType);
                    if (task.lag !== undefined) nextRow.lag = Number(task.lag) || 0;

                    return nextRow;
                });

                return rebuildFromRows(newRows);
            });
        };

        const handleAdd = (ev: any) => {
            const task = ev?.task;
            if (!task || task.id == null) return;

            setRows((prev) => {
                if (prev.some((row) => row.id === task.id)) return prev;

                const startDate = toDateInputValue(task.start ?? new Date());
                const endDate = toDateInputValue(task.end ?? task.start ?? new Date());
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
                    durationDays: computeDurationDays(startDate, endDate),
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
                const nextRows = prev.filter((row) => row.id !== id && row.parentId !== id);
                return rebuildFromRows(nextRows);
            });
        };

        api.on("update-task", handleUpdate);
        api.on("add-task", handleAdd);
        api.on("delete-task", handleDelete);

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
        <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "#f9fafb" }}>
            <div style={{ padding: "16px 24px", backgroundColor: "#fff", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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

            <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
                <div style={{ display: "flex", height: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid #e5e7eb", background: "#fff" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Willow>
                            <Gantt
                                init={setApi}
                                tasks={ganttData.tasks}
                                links={ganttData.links}
                                columns={activeColumns}
                                scales={ganttScales}
                                start={calendarRange.start}
                                end={calendarRange.end}
                            />
                        </Willow>
                    </div>
                    {api && <CustomTaskEditor api={api} rows={rows} onUpdateRow={handleUpdateRow} />}
                </div>
            </div>

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
