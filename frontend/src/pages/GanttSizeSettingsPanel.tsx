import React, { useEffect, useState } from "react";

export type GanttSizeSettings = {
    cellWidth: number;
    cellHeight: number;
    scaleHeight: number;
};

type Props = {
    value: GanttSizeSettings;
    onApply: (nextValue: GanttSizeSettings) => void;
    onReset: () => void;
    onClose: () => void;
};

const PANEL_STYLE: React.CSSProperties = {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: 360,
    background: "#ffffff",
    borderLeft: "1px solid #e5e7eb",
    boxShadow: "-8px 0 24px rgba(0,0,0,0.08)",
    zIndex: 1000,
    display: "flex",
    flexDirection: "column",
};

const INPUT_STYLE: React.CSSProperties = {
    width: "100%",
    height: 36,
    border: "1px solid #d1d5db",
    borderRadius: 6,
    padding: "0 10px",
    boxSizing: "border-box",
};

const RANGE_STYLE: React.CSSProperties = {
    width: "100%",
    cursor: "pointer",
};

const FIELD_WRAP_STYLE: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
};

const MIN_SIZE = 20;
const MAX_SIZE = 100;

function clampSize(value: number): number {
    if (!Number.isFinite(value)) return MIN_SIZE;
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));
}

function normalizeSizeNumber(value: string, fallback: number): number {
    const trimmed = value.trim();
    if (trimmed === "") return fallback;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return fallback;

    return clampSize(parsed);
}

type SizeFieldKey = keyof GanttSizeSettings;

type SizeControlProps = {
    label: string;
    field: SizeFieldKey;
    draft: GanttSizeSettings;
    setDraft: React.Dispatch<React.SetStateAction<GanttSizeSettings>>;
};

function SizeControl({ label, field, draft, setDraft }: SizeControlProps) {
    const currentValue = draft[field];

    return (
        <div style={FIELD_WRAP_STYLE}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>{label}</label>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{MIN_SIZE} ~ {MAX_SIZE}</span>
            </div>

            <input
                type="number"
                min={MIN_SIZE}
                max={MAX_SIZE}
                step={1}
                value={currentValue}
                onChange={(e) => {
                    const nextValue = normalizeSizeNumber(e.target.value, currentValue);
                    setDraft((prev) => ({
                        ...prev,
                        [field]: nextValue,
                    }));
                }}
                style={INPUT_STYLE}
            />

            <input
                type="range"
                min={MIN_SIZE}
                max={MAX_SIZE}
                step={1}
                value={currentValue}
                onChange={(e) => {
                    const nextValue = clampSize(Number(e.target.value));
                    setDraft((prev) => ({
                        ...prev,
                        [field]: nextValue,
                    }));
                }}
                style={RANGE_STYLE}
            />
        </div>
    );
}

export default function GanttSizeSettingsPanel({ value, onApply, onReset, onClose }: Props) {
    const [draft, setDraft] = useState<GanttSizeSettings>({
        cellWidth: clampSize(value.cellWidth),
        cellHeight: clampSize(value.cellHeight),
        scaleHeight: clampSize(value.scaleHeight),
    });

    useEffect(() => {
        setDraft({
            cellWidth: clampSize(value.cellWidth),
            cellHeight: clampSize(value.cellHeight),
            scaleHeight: clampSize(value.scaleHeight),
        });
    }, [value]);

    return (
        <>
            <div
                onClick={onClose}
                style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(15, 23, 42, 0.28)",
                    zIndex: 999,
                }}
            />

            <div style={PANEL_STYLE}>
                <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #e5e7eb" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Gantt 크기 설정</h3>
                        <button
                            onClick={onClose}
                            style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18 }}
                        >
                            ✕
                        </button>
                    </div>
                    <p style={{ margin: "10px 0 0", color: "#6b7280", fontSize: 13, lineHeight: 1.5 }}>
                        셀 가로폭, 행 높이, 상단 스케일 높이를 조정합니다.
                        숫자 입력과 슬라이더 모두 사용할 수 있고, 허용 범위는 20~100입니다.
                    </p>
                </div>

                <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                    <SizeControl label="cellWidth" field="cellWidth" draft={draft} setDraft={setDraft} />
                    <SizeControl label="cellHeight" field="cellHeight" draft={draft} setDraft={setDraft} />
                    <SizeControl label="scaleHeight" field="scaleHeight" draft={draft} setDraft={setDraft} />
                </div>

                <div style={{ padding: 20, borderTop: "1px solid #e5e7eb", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                        onClick={() => {
                            onReset();
                            onClose();
                        }}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            cursor: "pointer",
                            fontWeight: 600,
                        }}
                    >
                        초기화
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            cursor: "pointer",
                            fontWeight: 600,
                        }}
                    >
                        닫기
                    </button>
                    <button
                        onClick={() => {
                            onApply({
                                cellWidth: clampSize(draft.cellWidth),
                                cellHeight: clampSize(draft.cellHeight),
                                scaleHeight: clampSize(draft.scaleHeight),
                            });
                            onClose();
                        }}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 6,
                            border: "none",
                            background: "#2563eb",
                            color: "#fff",
                            cursor: "pointer",
                            fontWeight: 700,
                        }}
                    >
                        적용
                    </button>
                </div>
            </div>
        </>
    );
}
