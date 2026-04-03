import React from "react";
import type { SummaryInfo } from "../../types";
import WbsLevelFilter from "./WbsLevelFilter";

interface GanttHeaderProps {
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; // 부모 창(WbsSvarGanttPage)의 state.handleFileUpload 엑셀 처리 핸들러 전달받음
    summary: SummaryInfo; // 부모 창(state.summary): 엑셀 파싱 직후 도출된 전체 노드/내역 요약 데이터 정보
    totalRowsCount: number; // 부모 창(state.rows.length): 현재 화면에 렌더링 중인 전체 작업(행) 개수 합계치
    onColumnSettingsClick: () => void; // 부모 창에서 상태 업데이트 함수인 setShowColumnPopup(true)를 트리거하기 위해 넘겨준 콜백
    onSizeSettingsClick: () => void; // 부모 창에서 상태 업데이트 함수인 setShowSizeSettings(true)를 트리거하기 위해 넘겨준 콜백
    onCpmCalculationClick: () => void; // 부모 창(useGanttState)에 정의된 주공정(CPM) 연산 명령 함수인 handleCpmCalculation 매핑
    isCpmDisabled: boolean; // 데이터가 아예 없을 때(row 길이 0) 부모가 true로 보내어 버튼을 클릭 불능 상태로 만들기 위한 플래그
    cpmError: string | null; // 부모 영역에서 CPM 계산 중 문제가 발생할 경우 내려보내는 각종 오류 메시지 문자열
    // 레벨 필터
    availableLevels: number[]; // 부모 상태(state.availableLevels): 데이터상 실제로 존재하는 WBS 트리 깊이(레벨)들을 추려낸 배열
    levelFilter: Set<number>; // 부모 상태(state.levelFilter): 사용자가 화면에만 띄우기 위해 필터링 처리해둔 선택 레벨들 묶음
    onLevelFilterChange: (level: number) => void; // 부모 창(WbsSvarGanttPage)에 정의된 개별 필터 토글 제어용 handleLevelFilterChange 함수
    onLevelFilterReset: () => void; // 부모 창 전역 필터를 모두 초기화할 수 있게 연결해둔 handleLevelFilterReset 함수
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
                    <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", margin: 0 }}>NeXura T</h2>
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
