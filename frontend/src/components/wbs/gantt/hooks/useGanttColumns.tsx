import { useMemo } from "react";
import MoneyCell from "../components/MoneyCell";
import { toOptionalDateInputValue } from "../utils/helpers";
import { DATE_INPUT_STYLE } from "../constants";
import CopyCell from "../../CopyCell";


/**
 * Gantt의 스케일(상단 헤더 날짜)과 기본 컬럼(좌측 그리드)을 생성하는 훅
 * @param applyDateChange 날짜 변경 시 호출될 콜백 함수
 * @returns { baseColumns, ganttScales }
 */
export function useGanttColumns(
    applyDateChange: (rowId: number, field: "startDate" | "endDate", rawValue: string) => void
) {
    const baseColumns: any[] = useMemo(() => [
        { id: "text", header: "공종명", width: 250 },
        {
            id: "wbsCode", header: "WBS Code", width: 200, cell: ({ row }: any) => (
                <CopyCell value={row.wbsCode} />
            ),
        },
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
        {
            id: "predecessorCode",
            header: "선행작업",
            width: 200,
            cell: ({ row }: any) => (
                //tooltip 표시
                <div
                    title={row.predecessorCode}
                    style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                    }}
                >
                    {row.predecessorCode || "-"}
                </div>
            )
        },
        { id: "relationType", header: "관계유형", width: 90 },
        { id: "lag", header: "간격(Lag)", width: 80 },
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
            id: "isCritical",
            header: "주공정",
            width: 80,
            align: "center",
            cell: ({ row }: any) => {
                const isLeaf = !row.children || row.children.length === 0;

                if (!isLeaf) return "-";

                return row.isCritical == null ? "-" : (
                    <span
                        style={{
                            fontWeight: "bold",
                            color: row.isCritical ? "#ef4444" : "#6b7280"
                        }}
                    >
                        {row.isCritical ? "Y" : "N"}
                    </span>
                );
            },
        }
    ], [applyDateChange]);

    return { baseColumns };
}
