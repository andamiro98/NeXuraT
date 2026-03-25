import { useEffect, useState } from "react";
import type { EditableWbsRow } from "./types";
import { computeDurationDays } from "./scheduleUtils";

interface CustomTaskEditorProps {
    api: any;
    rows: EditableWbsRow[];
    onUpdateRow: (id: number, updates: Partial<EditableWbsRow>) => void;
}

export default function CustomTaskEditor({ api, rows, onUpdateRow }: CustomTaskEditorProps) {
    const [selectedId, setSelectedId] = useState<number | string | null>(null);
    const [userClosed, setUserClosed] = useState(false);

    useEffect(() => {
        if (!api) return;

        // SVAR UI Gantt State Listener
        // Since we might not know the exact selection event, we can safely listen to state changes 
        // or specifically selection events if applicable.
        const handleStateChange = () => {
            const state = api.getState();
            if (state && state.selected && state.selected.length > 0) {
                if (state.selected[0] !== selectedId) {
                    setSelectedId(state.selected[0]);
                    setUserClosed(false);
                }
            } else if (state && (!state.selected || state.selected.length === 0)) {
                if (selectedId !== null) {
                    setSelectedId(null);
                }
            }
        };

        const handleTaskClick = (ev: any) => {
            if (ev?.id === selectedId) {
                setUserClosed(false);
            }
            handleStateChange();
        };

        // Poll or subscribe to state
        // SVAR exposes State observing. A safe way if event names aren't documented is subscribe to 'state' if possible
        // or 'select-task'. Let's listen to commonly used events:
        api.on("select-task", handleStateChange);
        api.on("unselect-task", handleStateChange);
        api.on("click-task", handleTaskClick);

        // Fallback polling just in case events are different
        const interval = setInterval(handleStateChange, 200);

        return () => {
            if (typeof api.off === "function") {
                api.off("select-task", handleStateChange);
                api.off("unselect-task", handleStateChange);
                api.off("click-task", handleTaskClick);
            } else if (typeof api.detach === "function") {
                api.detach("select-task", handleStateChange);
                api.detach("unselect-task", handleStateChange);
                api.detach("click-task", handleTaskClick);
            }
            clearInterval(interval);
        };
    }, [api, selectedId]);

    const row = rows.find((r) => String(r.id) === String(selectedId));

    if (!row || userClosed) {
        return null; // Don't render if nothing is selected or user closed it
    }

    const handleChange = (field: keyof EditableWbsRow, value: any) => {
        const updates: Partial<EditableWbsRow> = { [field]: value };
        
        // If dates mutate, recalculate duration
        if (field === "startDate" || field === "endDate") {
            const newStart = field === "startDate" ? value : row.startDate;
            const newEnd = field === "endDate" ? value : row.endDate;
            updates.durationDays = computeDurationDays(newStart, newEnd);
        }
        
        onUpdateRow(row.id, updates);
    };

    const handleClose = () => {
        setUserClosed(true);
        if (api) {
            try {
                // Unselect in SVAR
                api.exec("unselect-task", { id: selectedId });
                // Also update the store directly if needed in SVAR
                const state = api.getState();
                if (state) state.selected = [];
            } catch (e) {
                // Ignore errors if the internal SVAR command fails
            }
        }
    };

    return (
        <div style={{
            width: "350px",
            borderLeft: "1px solid #e5e7eb",
            backgroundColor: "#fff",
            display: "flex",
            flexDirection: "column",
            boxShadow: "-2px 0 8px rgba(0,0,0,0.05)",
            zIndex: 10,
            overflowY: "auto"
        }}>
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px",
                borderBottom: "1px solid #e5e7eb"
            }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: "#374151" }}>작업 상세 정보</h3>
                <button 
                    onClick={handleClose}
                    style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#6b7280" }}
                >
                    &times;
                </button>
            </div>

            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>공종명 (Name)</label>
                    <input 
                        type="text" 
                        value={row.workName || ""} 
                        onChange={(e) => handleChange("workName", e.target.value)}
                        style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "14px" }}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>착수일 (Start Date)</label>
                    <input 
                        type="date" 
                        value={row.startDate || ""} 
                        onChange={(e) => handleChange("startDate", e.target.value)}
                        style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "14px" }}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>종료일 (End Date)</label>
                    <input 
                        type="date" 
                        value={row.endDate || ""} 
                        onChange={(e) => handleChange("endDate", e.target.value)}
                        style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "14px" }}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>기간 (Duration, 영업일 기준)</label>
                    <div style={{ 
                        padding: "8px", 
                        backgroundColor: "#f3f4f6", 
                        border: "1px solid #d1d5db", 
                        borderRadius: "4px", 
                        fontSize: "14px",
                        color: "#374151"
                    }}>
                        {row.durationDays !== null ? `${row.durationDays} 일` : "-"}
                    </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>선행 작업 (Predecessor)</label>
                    <input 
                        type="text" 
                        value={row.predecessorCode || ""} 
                        onChange={(e) => handleChange("predecessorCode", e.target.value)}
                        style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "14px" }}
                        placeholder="e.g. A01"
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>관계 유형 (Relation Type)</label>
                    <select 
                        value={row.relationType || ""} 
                        onChange={(e) => handleChange("relationType", e.target.value)}
                        style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "14px", backgroundColor: "#fff" }}
                    >
                        <option value="">-</option>
                        <option value="FS">FS (Finish to Start)</option>
                        <option value="FF">FF (Finish to Finish)</option>
                        <option value="SS">SS (Start to Start)</option>
                        <option value="SF">SF (Start to Finish)</option>
                    </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600" }}>간격 (Lag)</label>
                    <input 
                        type="number" 
                        value={row.lag || 0} 
                        onChange={(e) => handleChange("lag", Number(e.target.value))}
                        style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "14px" }}
                    />
                </div>

            </div>
        </div>
    );
}
