import { useEffect, useState } from "react";
import type { EditableWbsRow } from "./types";
import { computeDurationDays } from "./scheduleUtils";

interface CustomTaskEditorProps {
    api: any; // 부모 컴포넌트(WbsSvarGanttPage)에서 SVAR 간트 라이브러리 초기화 후 반환받아 넘겨준 내부 API/이벤트 제어용 인스턴스
    rows: EditableWbsRow[]; // 부모 단의 useGanttState 훅에서 전체 상태로 보유 중인 1차원 형태 공종(WBS) 목록 전체 데이터
    onUpdateRow: (id: number, updates: Partial<EditableWbsRow>) => void; // 우측 에디터에서 수정한 내용을 부모 메인 상태 배열에 덮어쓰도록 연결된 handleUpdateRow 콜백 기능
}

export default function CustomTaskEditor({ api, rows, onUpdateRow }: CustomTaskEditorProps) {
    const [selectedId, setSelectedId] = useState<number | string | null>(null); // 좌측 트리나 간트 차트에서 현재 선택(포커싱)되어 우측 상세 패널에 내용을 띄워놓은 작업의 ID 번호
    const [userClosed, setUserClosed] = useState(false); // 사용자가 직접 패널의 닫기('X') 버튼을 눌러서 의도적으로 상세 편집창을 숨겼는지 나타내는 상태 플래그
    const [isExpanded, setIsExpanded] = useState(false); // 하단 상세 테이블 등이 넓게 보일 수 있게 패널 자체의 가로폭(width)을 토글 형태로 넓혔는지 여부 상태

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
            }
            // 간트 데이터가 서버/상태 쪽에서 갱신(rebuild)될 때 내부적으로 선택(selected)이
            // 일시 해제(empty)되어버리는 증상이 있으므로, 이때 에디터가 닫히지 않도록
            // null 세팅 로직을 제거
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

    // 간트 데이터(rows) 갱신 시 SVAR Gantt 내부적으로 선택이 풀려버리는 현상을 보완하기 위해
    // 현재 에디터가 띄워져 있는 작동 중인 공종(Task)을 강제로 다시 선택(Highlight) 상태로 만들어줍니다.
    useEffect(() => {
        if (!api || !selectedId || userClosed || !row) return;

        const state = api.getState();
        if (state && (!state.selected || !state.selected.includes(selectedId))) {
            const timer = setTimeout(() => {
                try {
                    api.exec("select-task", { id: selectedId });
                } catch (e) {
                    // 무시
                }
            }, 10);
            return () => clearTimeout(timer);
        }
    }, [api, selectedId, userClosed, row, rows]);

    if (!row || userClosed) {
        return null; // Don't render if nothing is selected or user closed it
    }

    // 선행작업 다중 입력을 UI에 표시할 수 있는 객체 배열 구조로 파싱하는 헬퍼 함수
    const parsedPredecessors = (() => {
        // 데이터가 아예 없는 경우 빈 배열을 리턴하여 UI에 선행작업 입력 폼을 띄우지 않음
        if (row.predecessorCode == null && row.relationType == null && row.lag == null) return [];

        // null과 undefined를 텍스트 편집 오류 없이 다루도록 빈 문자열("")로 캐스팅
        const rawCode = String(row.predecessorCode || "");
        const rawRel = String(row.relationType || "");
        const rawLag = String(row.lag || "");

        // 입력창 진입 시 선행 조건 3가지 필드가 모두 완전히 비어있다면, 등록된 선행작업이 없는 상태로 취급
        if (!rawCode && !rawRel && !rawLag) return [];

        // 콤마(,)를 기준으로 여러 개의 값을 자른 뒤 좌우 공백 제거 처리
        // filter(Boolean)을 사용하지 않는 이유: 작성 중인 빈칸(빈 문자열) 폼이 화면 렌더링 시 사라지는 현상을 방지
        const predCodes = rawCode.split(",").map(s => s.trim());
        // 관계 유형 비어있으면 기본값 "FS", 지연 일수 비어있으면 기본 숫자 "0" 문자열로 대응 처리
        const relTypes = rawRel.split(",").map(s => s.trim() || "FS");
        const lags = rawLag.split(",").map(s => s.trim() || "0");

        // 코드, 관계유형, 지연 중 가장 긴 길이를 찾아 전체 화면에 그려야 할 필드 조합(Row) 개수 결정
        const len = Math.max(predCodes.length, relTypes.length, lags.length);
        const result = [];

        for (let i = 0; i < len; i++) {
            let code = predCodes[i] || "";
            let rel = relTypes[i] || "FS";
            let lag = lags[i] || "0";

            // "A100FS+2"처럼 엑셀 셀 한 칸에 공백 없이 뭉쳐서 작성한 임베디드 특수 형태 대응 로직
            const hasEmbeddedRel = /^.+(FS|SS|FF|SF)([+-]\d+)?$/i.test(code);
            if (hasEmbeddedRel) {
                const match = code.match(/^(.+?)(FS|SS|FF|SF)([+-]\d+)?$/i);
                if (match) {
                    code = match[1].trim(); // 1그룹: WBS 코드 분리 추출
                    rel = match[2].toUpperCase(); // 2그룹: 관계유형 추출 후 무조건 대문자화(FS 등)
                    lag = match[3] ? match[3] : "0"; // 3그룹: 지연시간(Lag) 추출, 없으면 0 세팅
                }
            }
            // 최종적으로 정리된 단일 선행작업 정보 한 묶음을 결과 배열에 적재
            result.push({ code, rel, lag });
        }
        return result;
    })();

    // 수정된 객체 배열 폼을 다시 콤마(,) 문자열 형태로 직렬화하여 부모 상태에 업데이트하는 반영 헬퍼 함수
    const applyPredecessors = (newPredecessors: { code: string, rel: string, lag: string }[]) => {
        // 모든 선행작업이 삭제되어 빈 배열이 되었다면, 기존 상태도 전부 빈 문자열로 지워서 부모 측 전파
        if (newPredecessors.length === 0) {
            onUpdateRow(row.id, { predecessorCode: "", relationType: "", lag: "" });
            return;
        }
        // 각 객체의 내부 속성을 분리하여 'A100, A200'과 같이 쉼표로 연결된 문자열 형태로 병합 가공
        const predCode = newPredecessors.map(p => p.code).join(", ");
        const relationType = newPredecessors.map(p => p.rel).join(", ");
        const lag = newPredecessors.map(p => p.lag).join(", ");

        // 최종 생성된 1차원 문자열들을 상위 데이터 업데이트 콜백 함수인 handleUpdateRow(부모단)에 인계
        onUpdateRow(row.id, { predecessorCode: predCode, relationType, lag });
    };

    // 하단 '+ 추가' 버튼 클릭 핸들러: 현재 작업 배열 끝단에 초깃값을 가진 새로운 빈 폼 항목 객체 추가
    const handleAddPredecessor = () => {
        applyPredecessors([...parsedPredecessors, { code: "", rel: "FS", lag: "0" }]);
    };

    // 우측 '삭제(X)' 버튼 클릭 핸들러: 해당 index 위치에 매칭되는 선행 조건 단건을 삭제 및 재반영
    const handleRemovePredecessor = (index: number) => {
        const next = [...parsedPredecessors]; // 외부 상태의 불변성 훼손을 방지하기 위한 깊은 복사
        next.splice(index, 1);
        applyPredecessors(next);
    };

    // 특정 항목 내 각각의 인풋, 셀렉트 박스 값이 바뀔 때마다 변경사항을 덮어씌워 적용
    const handlePredecessorChange = (index: number, field: "code" | "rel" | "lag", value: string) => {
        const next = [...parsedPredecessors];
        next[index] = { ...next[index], [field]: value }; // 구조 분해 할당을 통해 변경된 필드 속성만 수정
        applyPredecessors(next);
    };

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

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px", padding: "12px", backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <label style={{ fontSize: "13px", color: "#374151", fontWeight: "700" }}>선행 작업 (Predecessors)</label>
                        <button onClick={handleAddPredecessor} style={{ fontSize: "11px", padding: "4px 8px", cursor: "pointer", border: "1px solid #d1d5db", borderRadius: "4px", backgroundColor: "#fff", fontWeight: "600", color: "#374151" }}>+ 추가</button>
                    </div>

                    {parsedPredecessors.map((p, i) => (
                        <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <input
                                type="text"
                                value={p.code}
                                onChange={(e) => handlePredecessorChange(i, "code", e.target.value)}
                                style={{ flex: 1, padding: "6px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "13px" }}
                                placeholder="작업코드 (예: A01)"
                            />
                            <select
                                value={p.rel}
                                onChange={(e) => handlePredecessorChange(i, "rel", e.target.value)}
                                style={{ width: "65px", padding: "6px", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "13px", backgroundColor: "#fff" }}
                            >
                                <option value="FS">FS</option>
                                <option value="FF">FF</option>
                                <option value="SS">SS</option>
                                <option value="SF">SF</option>
                            </select>
                            <div style={{ display: "flex", alignItems: "center", border: "1px solid #d1d5db", borderRadius: "4px", backgroundColor: "#fff", overflow: "hidden" }}>
                                <span style={{ padding: "6px", fontSize: "12px", color: "#6b7280", backgroundColor: "#f3f4f6", borderRight: "1px solid #d1d5db" }}>Lag</span>
                                <input
                                    type="text"
                                    value={p.lag}
                                    onChange={(e) => handlePredecessorChange(i, "lag", e.target.value)}
                                    style={{ width: "40px", padding: "6px", border: "none", fontSize: "13px", textAlign: "center", outline: "none" }}
                                    placeholder="0"
                                />
                            </div>
                            <button onClick={() => handleRemovePredecessor(i)} title="삭제" style={{ padding: "4px", background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>&times;</button>
                        </div>
                    ))}
                    {parsedPredecessors.length === 0 && (
                        <div style={{ fontSize: "12px", color: "#9ca3af", textAlign: "center", padding: "8px 0" }}>등록된 선행 작업이 없습니다.</div>
                    )}
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
