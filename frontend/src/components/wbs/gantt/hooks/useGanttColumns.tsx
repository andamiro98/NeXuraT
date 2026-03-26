import { useMemo } from "react";
import MoneyCell from "../components/MoneyCell";
import { toOptionalDateInputValue } from "../utils/helpers";
import { DATE_INPUT_STYLE } from "../constants";

// scale format 콜백 인자를 Date 객체로 정리
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

/**
 * Gantt의 스케일(상단 헤더 날짜)과 기본 컬럼(좌측 그리드)을 생성하는 훅
 * @param applyDateChange 날짜 변경 시 호출될 콜백 함수
 * @returns { baseColumns, ganttScales }
 */
export function useGanttColumns(
    applyDateChange: (rowId: number, field: "startDate" | "endDate", rawValue: string) => void
) {
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
                    value={toOptionalDateInputValue(row.startDate ?? row.start)}
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
                    value={toOptionalDateInputValue(row.endDate ?? row.end)}
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
        { id: "totalAmount", header: "합계금액", width: 100, cell: ({ row }: any) => <MoneyCell val={row.totalAmount} /> },
        { id: "es", header: "ES", width: 60, align: "center", cell: ({ row }: any) => row.es != null ? row.es : "-" },
        { id: "ef", header: "EF", width: 60, align: "center", cell: ({ row }: any) => row.ef != null ? row.ef : "-" },
        { id: "ls", header: "LS", width: 60, align: "center", cell: ({ row }: any) => row.ls != null ? row.ls : "-" },
        { id: "lf", header: "LF", width: 60, align: "center", cell: ({ row }: any) => row.lf != null ? row.lf : "-" },
        { id: "tf", header: "TF", width: 60, align: "center", cell: ({ row }: any) => row.tf != null ? row.tf : "-" },
        { id: "ff", header: "FF", width: 60, align: "center", cell: ({ row }: any) => row.ff != null ? row.ff : "-" },
        {
            id: "isCritical", header: "주공정", width: 80, align: "center",
            cell: ({ row }: any) => (
                row.isCritical == null ? "-" :
                    <span style={{ fontWeight: "bold", color: row.isCritical ? "#ef4444" : "#6b7280" }}>
                        {row.isCritical ? "Y" : "N"}
                    </span>
            )
        },
    ], [applyDateChange]);

    return { baseColumns, ganttScales };
}
