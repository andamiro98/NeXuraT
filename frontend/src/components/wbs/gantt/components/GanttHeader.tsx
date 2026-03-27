import React from "react";
import type { SummaryInfo } from "../../types";
import WbsLevelFilter from "./WbsLevelFilter";

interface GanttHeaderProps {
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    summary: SummaryInfo;
    totalRowsCount: number;
    onColumnSettingsClick: () => void;
    onSizeSettingsClick: () => void;
    onCpmCalculationClick: () => void;
    isCpmDisabled: boolean;
    cpmError: string | null;
    // 레벨 필터
    availableLevels: number[];
    levelFilter: Set<number>;
    onLevelFilterChange: (level: number) => void;
    onLevelFilterReset: () => void;
}

export default function GanttHeader({
    onFileUpload,
    summary,
    totalRowsCount,
    onColumnSettingsClick,
    onSizeSettingsClick,
    onCpmCalculationClick,
    isCpmDisabled,
    cpmError,
    availableLevels,
    levelFilter,
    onLevelFilterChange,
    onLevelFilterReset,
}: GanttHeaderProps) {
    return (
        <>
            <div style={{ padding: "16px 24px", backgroundColor: "#fff", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                    <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", margin: 0 }}>Gantt Chart (SVAR Native)</h2>
                    <input
                        type="file"
                        accept=".xlsx, .xls, .xlsm"
                        onChange={onFileUpload}
                        style={{ border: "1px solid #d1d5db", borderRadius: "4px", padding: "4px" }}
                    />
                    {summary.createdNodeCount > 0 && (
                        <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                            생성된 공종 수: {summary.createdNodeCount}
                        </span>
                    )}
                </div>
                <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                        전체 항목 수: {totalRowsCount}
                    </span>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button onClick={onColumnSettingsClick} style={{ padding: "8px 16px", backgroundColor: "#10b981", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                            ⚙ 컬럼 설정
                        </button>
                        <button onClick={onSizeSettingsClick} style={{ padding: "8px 16px", backgroundColor: "#0ea5e9", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
                            ↔ 차트 크기/줌 설정
                        </button>
                        <button
                            onClick={onCpmCalculationClick}
                            disabled={isCpmDisabled}
                            style={{ padding: "8px 16px", backgroundColor: isCpmDisabled ? "#9ca3af" : "#7c3aed", color: "#fff", border: "none", borderRadius: "4px", cursor: isCpmDisabled ? "not-allowed" : "pointer", fontWeight: "bold" }}
                        >
                            📊 CPM 계산
                        </button>
                    </div>
                </div>
            </div>

            {/* 레벨 필터 바 (별도 컴포넌트) */}
            <WbsLevelFilter
                availableLevels={availableLevels}
                levelFilter={levelFilter}
                onLevelToggle={onLevelFilterChange}
                onReset={onLevelFilterReset}
            />

            {cpmError && (
                <div style={{ padding: "8px 24px", backgroundColor: "#fef2f2", borderBottom: "1px solid #fca5a5", color: "#dc2626", fontSize: "0.875rem" }}>
                    ⚠️ CPM 계산 오류: {cpmError}
                </div>
            )}
        </>
    );
}
