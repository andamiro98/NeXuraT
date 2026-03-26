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
    const [isExpanded, setIsExpanded] = useState(false);

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
            const dur = computeDurationDays(newStart, newEnd);
            updates.durationDays = dur != null ? String(dur) : null;
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
            width: isExpanded ? "800px" : "350px", // 확대/축소 기능
            minWidth: isExpanded ? "800px" : "350px", // Flex layout 유지 위한 최소 너비 고정
            transition: "width 0.2s ease-in-out, min-width 0.2s ease-in-out",
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
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        title={isExpanded ? "축소하기" : "확대하기"}
                        style={{ background: "none", border: "1px solid #d1d5db", borderRadius: "4px", padding: "4px 8px", fontSize: "12px", cursor: "pointer", color: "#374151", outline: "none" }}
                    >
                        {isExpanded ? "축소 ➡" : "⬅ 확대"}
                    </button>
                    <button
                        onClick={handleClose}
                        style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#6b7280" }}
                    >
                        &times;
                    </button>
                </div>
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
                        type="text"
                        value={row.lag || 0}
                        onChange={(e) => handleChange("lag", Number(e.target.value))}
                        style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "14px" }}
                    />
                </div>

                {/* 1. 하위 내역이 존재할 때만 렌더링 (1~6레벨 등 내역이 없으면 테이블 영역을 생성하지 않음) */}
                {row.detailItems && row.detailItems.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                        <label style={{ fontSize: "12px", color: "#374151", fontWeight: "700", borderBottom: "1px solid #e5e7eb", paddingBottom: "4px" }}>
                            상세 내역 ({row.detailItems.length}건)
                        </label>
                        {/* 2. 가로 스크롤 허용: 컬럼이 많아 에디터 폭을 넘어가더라도 가로 스크롤바가 생기도록 강제 */}
                        <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse", minWidth: "900px" }}>
                                <thead>
                                    {/* 3. 상단 2단 그룹 헤더 (합계/재료비/노무비/경비의 단가와 금액을 그룹핑) */}
                                    <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                                        <th rowSpan={2} style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "left" }}>WBS</th>
                                        <th rowSpan={2} style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "left" }}>공종명</th>
                                        <th rowSpan={2} style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "left" }}>규격</th>
                                        <th rowSpan={2} style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "right" }}>수량</th>
                                        <th rowSpan={2} style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "center" }}>단위</th>
                                        <th colSpan={2} style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "center" }}>합계</th>
                                        <th colSpan={2} style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "center" }}>재료비</th>
                                        <th colSpan={2} style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "center" }}>노무비</th>
                                        <th colSpan={2} style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "center" }}>경비</th>
                                        <th rowSpan={2} style={{ padding: "4px", textAlign: "left" }}>비고</th>
                                    </tr>
                                    <tr style={{ backgroundColor: "#fefefe", borderBottom: "1px solid #e5e7eb" }}>
                                        <th style={{ padding: "2px 4px", fontSize: "10px", textAlign: "right", borderRight: "1px solid #f3f4f6" }}>단가</th>
                                        <th style={{ padding: "2px 4px", fontSize: "10px", textAlign: "right", borderRight: "1px solid #e5e7eb" }}>금액</th>
                                        <th style={{ padding: "2px 4px", fontSize: "10px", textAlign: "right", borderRight: "1px solid #f3f4f6" }}>단가</th>
                                        <th style={{ padding: "2px 4px", fontSize: "10px", textAlign: "right", borderRight: "1px solid #e5e7eb" }}>금액</th>
                                        <th style={{ padding: "2px 4px", fontSize: "10px", textAlign: "right", borderRight: "1px solid #f3f4f6" }}>단가</th>
                                        <th style={{ padding: "2px 4px", fontSize: "10px", textAlign: "right", borderRight: "1px solid #e5e7eb" }}>금액</th>
                                        <th style={{ padding: "2px 4px", fontSize: "10px", textAlign: "right", borderRight: "1px solid #f3f4f6" }}>단가</th>
                                        <th style={{ padding: "2px 4px", fontSize: "10px", textAlign: "right", borderRight: "1px solid #e5e7eb" }}>금액</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* 4. 내역 항목들을 반복하며 테이블 행(tr) 생성 */}
                                    {row.detailItems.map((item, idx) => (
                                        <tr key={idx} style={{ borderBottom: "1px solid #f3f4f6" }}>
                                            <td style={{ padding: "4px", borderRight: "1px solid #e5e7eb", color: "#6b7280" }}>{item.wbsCode}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #e5e7eb", fontWeight: "500" }}>{item.workName}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #e5e7eb" }}>{item.spec}</td>
                                            
                                            {/* 5. 금액/수량 숫자 포맷팅 (.toLocaleString()으로 1,000단위 쉼표 추가) */}
                                            <td style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "right" }}>{item.quantity?.toLocaleString() ?? 0}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "center" }}>{item.unit}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #f3f4f6", textAlign: "right", color: "#6b7280" }}>{item.totalUnitPrice?.toLocaleString() ?? 0}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "right", fontWeight: "600", color: "#111827" }}>{item.totalAmount?.toLocaleString() ?? 0}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #f3f4f6", textAlign: "right", color: "#6b7280" }}>{item.materialUnitPrice?.toLocaleString() ?? 0}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "right", color: "#374151" }}>{item.materialAmount?.toLocaleString() ?? 0}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #f3f4f6", textAlign: "right", color: "#6b7280" }}>{item.laborUnitPrice?.toLocaleString() ?? 0}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "right", color: "#374151" }}>{item.laborAmount?.toLocaleString() ?? 0}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #f3f4f6", textAlign: "right", color: "#6b7280" }}>{item.expenseUnitPrice?.toLocaleString() ?? 0}</td>
                                            <td style={{ padding: "4px", borderRight: "1px solid #e5e7eb", textAlign: "right", color: "#374151" }}>{item.expenseAmount?.toLocaleString() ?? 0}</td>
                                            
                                            {/* 6. 비고란이 매우 길면 줄바꿈 없이 자르고 말풍선(title 속성)으로 전체 텍스트 제공 */}
                                            <td style={{ padding: "4px", color: "#6b7280", maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.remark}>{item.remark}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
