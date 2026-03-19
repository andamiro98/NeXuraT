import { type ChangeEvent, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Gantt, Willow } from "@svar-ui/react-gantt";
import "@svar-ui/react-gantt/all.css";

import TreeGrid from "../components/wbs/TreeGrid";
import {
    buildMergedHeaders,
    buildNodeTree,
    findHeaderRowIndex,
    flattenTreeToEditableRows,
    resolveColumnIndexes,
} from "../components/wbs/excelUtils";
import {
    buildScheduledGanttData,
    computeDurationDays,
    getCalendarRange,
    getVisibleRows,
} from "../components/wbs/scheduleUtils";
import type {
    EditableWbsRow,
    ExcelRow,
    SummaryInfo,
} from "../components/wbs/types";

// WBS 업로드 화면 전체를 담당
// 왼쪽 트리, 오른쪽 간트, 상단 업로드 바까지 다 포함
export default function WbsSvarGanttPage() {
    // rows: 왼쪽 테이블에 표시되는 전체 데이터 + 입력 상태
    const [rows, setRows] = useState<EditableWbsRow[]>([]);

    // 파일명 / 시트명 / 에러 / 요약 정보
    const [fileName, setFileName] = useState("");
    const [sheetName, setSheetName] = useState("");
    const [error, setError] = useState("");
    const [summary, setSummary] = useState<SummaryInfo>({
        createdNodeCount: 0,
        ignoredDetailRows: 0,
    });

    // 그리드 영역 너비 (마우스 드래그로 조절)
    const [gridWidth, setGridWidth] = useState(1250);
    const [isResizing, setIsResizing] = useState(false);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isResizing) return;
        const newWidth = Math.max(400, Math.min(2000, e.clientX));
        setGridWidth(newWidth);
    };

    const handleMouseUp = () => {
        setIsResizing(false);
    };

    // 초기 캘린더 범위
    const calendarRange = useMemo(() => getCalendarRange(), []);

    // 오른쪽 캘린더 상단 눈금 설정
    const ganttScales = [
        { unit: "month", step: 1, format: "%Y-%m" },
        { unit: "day", step: 1, format: "%d" },
    ];

    // 현재 트리 펼침/접힘 상태 기준으로 실제 화면에 보일 행들
    const visibleRows = useMemo(() => getVisibleRows(rows), [rows]);

    // 오른쪽 Gantt에 넘길 tasks/links
    const scheduledData = useMemo(() => buildScheduledGanttData(rows), [rows]);

    // 트리 토글
    const handleToggle = (id: number) => {
        setRows((prev) =>
            prev.map((row) =>
                row.id === id ? { ...row, open: !row.open } : row
            )
        );
    };

    // 입력값 변경
    const handleRowChange = (
        id: number,
        field:
            | "startDate"
            | "endDate"
            | "predecessorCode"
            | "relationType"
            | "lag",
        value: string
    ) => {
        setRows((prev) =>
            prev.map((row) => {
                if (row.id !== id) return row;

                // 변경된 필드만 업데이트
                const nextRow: EditableWbsRow = {
                    ...row,
                    [field]:
                        field === "lag"
                            ? Number.isFinite(Number(value))
                                ? Number(value)
                                : 0
                            : value,
                } as EditableWbsRow;

                // start/end가 바뀌면 duration도 재계산
                nextRow.durationDays = computeDurationDays(
                    nextRow.startDate,
                    nextRow.endDate
                );

                return nextRow;
            })
        );
    };

    // 엑셀 업로드 처리
    const handleFileChange = async (
        event: ChangeEvent<HTMLInputElement>
    ): Promise<void> => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            setError("");
            setFileName(file.name);

            // 브라우저에서 파일을 ArrayBuffer로 읽음
            const arrayBuffer = await file.arrayBuffer();

            // XLSX 라이브러리로 workbook 생성
            const workbook = XLSX.read(arrayBuffer, {
                type: "array",
                cellDates: false,
                raw: true,
            });

            // 첫 번째 시트 사용
            const firstSheetName = workbook.SheetNames[0];
            setSheetName(firstSheetName);

            const sheet = workbook.Sheets[firstSheetName];

            // header:1 => 객체 배열이 아니라 2차원 배열로 읽음
            const excelRows = XLSX.utils.sheet_to_json(sheet, {
                header: 1,
                raw: true,
                defval: "",
            }) as ExcelRow[];

            // WBS Lv가 있는 헤더 행 찾기
            const headerRowIndex = findHeaderRowIndex(excelRows);

            if (headerRowIndex === -1) {
                throw new Error(
                    "헤더 행을 찾지 못했습니다. 'WBS Lv' 컬럼이 있는지 확인해주세요."
                );
            }

            // 2줄 헤더 추출
            const topHeaderRow = excelRows[headerRowIndex] ?? [];
            const bottomHeaderRow = excelRows[headerRowIndex + 1] ?? [];

            // 실제 데이터 행
            const dataRows = excelRows.slice(headerRowIndex + 2);

            // 헤더 병합 후 컬럼 위치 찾기
            const mergedHeaders = buildMergedHeaders(topHeaderRow, bottomHeaderRow);
            const columnIndexes = resolveColumnIndexes(mergedHeaders);

            // WBS Lv 기반 트리 생성
            const { roots, createdNodeCount, ignoredDetailRows } = buildNodeTree(
                dataRows,
                columnIndexes
            );

            // 화면용 행 배열로 변환
            setRows(flattenTreeToEditableRows(roots));

            // 상단 요약 정보 갱신
            setSummary({
                createdNodeCount,
                ignoredDetailRows,
            });
        } catch (e) {
            // 에러 나면 상태 초기화
            setRows([]);
            setSummary({
                createdNodeCount: 0,
                ignoredDetailRows: 0,
            });

            setError(
                e instanceof Error
                    ? e.message
                    : "엑셀 파일을 읽는 중 오류가 발생했습니다."
            );
        }
    };

    return (
        <Willow>
            <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
                {/* 상단 바 */}
                <div
                    style={{
                        padding: 16,
                        borderBottom: "1px solid #e5e7eb",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        background: "#fff",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                        }}
                    >
                        {/* 파일 업로드 버튼 */}
                        <label
                            style={{
                                background: "#111827",
                                color: "#fff",
                                padding: "10px 14px",
                                borderRadius: 12,
                                cursor: "pointer",
                                fontWeight: 600,
                            }}
                        >
                            엑셀 업로드
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                style={{ display: "none" }}
                                onChange={handleFileChange}
                            />
                        </label>

                        <div>파일: {fileName || "-"}</div>
                        <div>시트: {sheetName || "-"}</div>
                        <div>트리 노드: {summary.createdNodeCount}개</div>
                        <div>무시된 "내역": {summary.ignoredDetailRows}개</div>
                        <div>일정 생성: {scheduledData.tasks.length}개</div>
                    </div>

                    <div style={{ fontSize: 13, color: "#6b7280" }}>
                        착수일과 종료일만 선택해도 간트가 생성됩니다.
                    </div>

                    {error && (
                        <div style={{ color: "#dc2626", fontSize: 14 }}>{error}</div>
                    )}
                </div>

                <div
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    style={{
                        flex: 1,
                        minHeight: 0,
                        display: "flex",
                        position: "relative",
                        userSelect: isResizing ? "none" : "auto",
                        cursor: isResizing ? "col-resize" : "default",
                    }}
                >
                    {rows.length === 0 ? (
                        <div
                            style={{
                                flex: 1,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "#f8fafc",
                                color: "#6b7280",
                                fontSize: 15,
                            }}
                        >
                            엑셀 파일을 업로드하면 WBS 트리와 캘린더가 표시됩니다.
                        </div>
                    ) : (
                        <>
                            {/* 왼쪽: 우리가 직접 만든 TreeGrid */}
                            <div style={{ width: gridWidth, flexShrink: 0, overflow: "hidden" }}>
                                <TreeGrid
                                    rows={visibleRows}
                                    onToggle={handleToggle}
                                    onChange={handleRowChange}
                                />
                            </div>

                            {/* 스플리터 (드래그 영역) */}
                            <div
                                onMouseDown={handleMouseDown}
                                style={{
                                    width: 6,
                                    cursor: "col-resize",
                                    background: isResizing ? "#3b82f6" : "#e5e7eb",
                                    zIndex: 10,
                                    transition: "background 0.2s",
                                }}
                            />

                            {/* 오른쪽: SVAR Gantt */}
                            <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
                                <Gantt
                                    columns={false as unknown as any}
                                    tasks={scheduledData.tasks as any}
                                    links={scheduledData.links as any}
                                    scales={ganttScales}
                                    start={calendarRange.start}
                                    end={calendarRange.end}
                                    cellWidth={36}
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </Willow>
    );
}