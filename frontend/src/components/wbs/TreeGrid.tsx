import type { CSSProperties } from "react";
import { formatMoney } from "./excelUtils";
import { isInvalidDateRange } from "./scheduleUtils";
import type { EditableWbsRow } from "./types";

// 이 컴포넌트가 바깥에서 받아야 하는 값들
interface TreeGridProps {
    rows: EditableWbsRow[];

    // 트리 접기/펼치기
    onToggle: (id: number) => void;

    // 입력값 변경
    onChange: (
        id: number,
        field:
            | "startDate"
            | "endDate"
            | "predecessorCode"
            | "relationType"
            | "lag",
        value: string
    ) => void;
}

// 이 컴포넌트는 "왼쪽 트리 테이블 UI" 역할만 한다.
// 상태 자체는 부모(page)에서 관리한다.
export default function TreeGrid({
    rows,
    onToggle,
    onChange,
}: TreeGridProps) {
    return (
        <div
            style={{
                height: "100%",
                overflow: "auto",
                borderRight: "1px solid #e5e7eb",
                background: "#fff",
            }}
        >
            <table
                style={{
                    width: "100%",
                    minWidth: 1770,
                    borderCollapse: "collapse",
                    tableLayout: "fixed",
                }}
            >
                {/* 각 컬럼 너비를 미리 고정한다.
            공종명이 세로로 깨지지 않도록 첫 컬럼을 넓게 잡는다. */}
                <colgroup>
                    <col style={{ width: 360 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 130 }} />
                </colgroup>

                <thead>
                    <tr style={{ background: "#f8fafc" }}>
                        {[
                            "공종명",
                            "WBS Code",
                            "착수일",
                            "종료일",
                            "기간(일)",
                            "선행작업(코드)",
                            "관계유형",
                            "간격(Lag)",
                            "합계 금액",
                            "재료비 금액",
                            "노무비 금액",
                            "경비 금액",
                        ].map((header) => (
                            <th
                                key={header}
                                style={{
                                    position: "sticky",
                                    top: 0,
                                    zIndex: 2,
                                    background: "#f8fafc",
                                    borderBottom: "1px solid #e5e7eb",
                                    padding: "10px 8px",
                                    fontSize: 13,
                                    fontWeight: 700,
                                    textAlign:
                                        header.includes("금액") ||
                                            header === "기간(일)" ||
                                            header === "간격(Lag)"
                                            ? "right"
                                            : "left",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>

                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id}>
                            {/* 공종명 컬럼: 트리 구조를 시각적으로 표현 */}
                            <td style={nameCellStyle}>
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 8,
                                        paddingLeft: (row.level - 1) * 18,
                                        minWidth: 0,
                                    }}
                                >
                                    {/* 자식이 있으면 접기/펼치기 버튼 */}
                                    {row.hasChildren ? (
                                        <button
                                            type="button"
                                            onClick={() => onToggle(row.id)}
                                            style={toggleButtonStyle}
                                        >
                                            {row.open ? "−" : "+"}
                                        </button>
                                    ) : (
                                        <span style={{ width: 24, flex: "0 0 24px" }} />
                                    )}

                                    {/* 공종명 텍스트
                    keep-all로 한국어 한 글자 줄바꿈 방지 */}
                                    <span
                                        style={{
                                            fontWeight: row.hasChildren ? 700 : 400,
                                            whiteSpace: "normal",
                                            wordBreak: "keep-all",
                                            overflowWrap: "normal",
                                            lineHeight: 1.45,
                                            display: "block",
                                        }}
                                        title={row.workName}
                                    >
                                        {row.workName}
                                    </span>
                                </div>
                            </td>

                            <td style={cellStyle}>{row.wbsCode || "-"}</td>

                            {/* 착수일 입력 */}
                            <td style={cellStyle}>
                                <input
                                    type="date"
                                    value={row.startDate}
                                    onChange={(e) => onChange(row.id, "startDate", e.target.value)}
                                    style={inputStyle}
                                />
                            </td>

                            {/* 종료일 입력
                날짜 범위 이상하면 빨간 테두리 */}
                            <td style={cellStyle}>
                                <input
                                    type="date"
                                    value={row.endDate}
                                    onChange={(e) => onChange(row.id, "endDate", e.target.value)}
                                    style={{
                                        ...inputStyle,
                                        borderColor: isInvalidDateRange(row) ? "#dc2626" : "#d1d5db",
                                    }}
                                />
                            </td>

                            <td style={numberCellStyle}>
                                {row.durationDays === null ? "-" : row.durationDays}
                            </td>

                            <td style={cellStyle}>
                                <input
                                    type="text"
                                    value={row.predecessorCode}
                                    onChange={(e) =>
                                        onChange(row.id, "predecessorCode", e.target.value)
                                    }
                                    style={inputStyle}
                                />
                            </td>

                            <td style={cellStyle}>
                                <select
                                    value={row.relationType}
                                    onChange={(e) =>
                                        onChange(row.id, "relationType", e.target.value)
                                    }
                                    style={inputStyle}
                                >
                                    <option value="">선택</option>
                                    <option value="FS">FS</option>
                                    <option value="FF">FF</option>
                                    <option value="SS">SS</option>
                                    <option value="SF">SF</option>
                                </select>
                            </td>

                            <td style={cellStyle}>
                                <input
                                    type="number"
                                    value={row.lag}
                                    onChange={(e) => onChange(row.id, "lag", e.target.value)}
                                    style={{ ...inputStyle, textAlign: "right" }}
                                />
                            </td>

                            <td style={numberCellStyle}>{formatMoney(row.totalAmount)}</td>
                            <td style={numberCellStyle}>{formatMoney(row.materialAmount)}</td>
                            <td style={numberCellStyle}>{formatMoney(row.laborAmount)}</td>
                            <td style={numberCellStyle}>{formatMoney(row.expenseAmount)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const cellStyle: CSSProperties = {
    borderBottom: "1px solid #f1f5f9",
    padding: 8,
    fontSize: 13,
    verticalAlign: "middle",
    background: "#fff",
};

const nameCellStyle: CSSProperties = {
    ...cellStyle,
    minWidth: 0,
};

const numberCellStyle: CSSProperties = {
    ...cellStyle,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
};

const inputStyle: CSSProperties = {
    width: "100%",
    height: 34,
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "0 10px",
    fontSize: 13,
    boxSizing: "border-box",
    background: "#fff",
};

const toggleButtonStyle: CSSProperties = {
    width: 24,
    height: 24,
    flex: "0 0 24px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
    lineHeight: 1,
};