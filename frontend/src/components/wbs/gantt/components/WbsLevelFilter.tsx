import React from "react";

interface WbsLevelFilterProps {
    availableLevels: number[];
    levelFilter: Set<number>;
    onLevelToggle: (level: number) => void;
    onReset: () => void;
}

export default function WbsLevelFilter({
    availableLevels,
    levelFilter,
    onLevelToggle,
    onReset,
}: WbsLevelFilterProps) {
    if (availableLevels.length === 0) return null;

    const btnBase: React.CSSProperties = {
        padding: "4px 14px",
        fontSize: "0.78rem",
        fontWeight: "bold",
        border: "1px solid",
        borderRadius: "999px",
        cursor: "pointer",
        transition: "background-color 0.15s, color 0.15s, border-color 0.15s",
        lineHeight: "1.4",
    };

    const activeStyle: React.CSSProperties = {
        ...btnBase,
        backgroundColor: "#2563eb",
        color: "#fff",
        borderColor: "#2563eb",
    };

    const inactiveStyle: React.CSSProperties = {
        ...btnBase,
        backgroundColor: "#fff",
        color: "#374151",
        borderColor: "#d1d5db",
    };

    const allActiveStyle: React.CSSProperties = {
        ...btnBase,
        backgroundColor: "#1e40af",
        color: "#fff",
        borderColor: "#1e40af",
    };

    return (
        <div
            style={{
                padding: "8px 24px",
                backgroundColor: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
            }}
        >
            <span
                style={{
                    fontSize: "0.8rem",
                    fontWeight: "bold",
                    color: "#374151",
                    whiteSpace: "nowrap",
                }}
            >
                🔍 레벨 필터:
            </span>

            {/* 전체 버튼 */}
            <button
                onClick={onReset}
                style={levelFilter.size === 0 ? allActiveStyle : inactiveStyle}
            >
                전체
            </button>

            {/* 레벨별 토글 버튼 */}
            {availableLevels.map((lv) => (
                <button
                    key={lv}
                    onClick={() => onLevelToggle(lv)}
                    style={levelFilter.has(lv) ? activeStyle : inactiveStyle}
                >
                    Lv {lv}
                </button>
            ))}

            {/* 선택 레벨 수 표시 */}
            {levelFilter.size > 0 && (
                <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                    ({levelFilter.size}개 레벨 선택됨)
                </span>
            )}
        </div>
    );
}
