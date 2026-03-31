import { useEffect } from "react";
import type { EditableWbsRow } from "../../types";
import {
    toOptionalDateInputValue,
    hasBothDates,
    normalizeRelationType
} from "../utils/helpers";
import { computeDurationDays } from "../../scheduleUtils";

import type { ColumnConfig } from "../../ColumnSettingsPopup";

/**
 *
 * @param api   SVAR Gantt에서 init 콜백을 통해 전달되는 API
 * @param setRows
 * @param rebuildFromRows
 * @param changeZoomBy
 * @param setColumnConfig
 */
export function useGanttEvents(
    api: any,
    setRows: React.Dispatch<React.SetStateAction<EditableWbsRow[]>>,
    rebuildFromRows: (nextRows: EditableWbsRow[]) => EditableWbsRow[],
    changeZoomBy: (dir: number) => void,
    setColumnConfig: React.Dispatch<React.SetStateAction<ColumnConfig[]>>
) {
    useEffect(() => {
        if (!api) return;

        let tableApi: any;
        let isMounted = true; // 비동기 작업 중 컴포넌트가 마운트 해제됐을 시 발생할 수 있는 업데이트 오류(Memory Leak) 방지용 플래그

        // 간트 내부의 트리그리드 컬럼 사이즈 조절 완료 이벤트 핸들러
        const handleResizeColumn = (ev: any) => {
            if (ev.inProgress) return; // 사용자가 좌우로 마우스를 계속 드래그 중인 미완료 상태일 때는 잦은 렌더링 방지를 위해 무시

            setColumnConfig((prev) => {
                const colIdx = prev.findIndex((c) => c.id === ev.id); // 변경된 대상 컬럼이 상태 배열의 몇 번째에 있는지 찾음
                // 컬럼이 목록에 존재하고, 변경된 사이즈가 기존 상태에 반영된 사이즈와 실제 차이가 있는 유효한 상황일 경우 동작
                if (colIdx >= 0 && ev.width !== undefined && prev[colIdx].width !== ev.width) {
                    const next = [...prev]; // 불변성(Immutability)을 유지하며 리액트 방식대로 배열 복제
                    next[colIdx] = { ...next[colIdx], width: ev.width }; // 새로 적용될 넓이(width) 속성을 덮어씌움
                    return next; // 변경된 배열 상태로 반환하여 재런더링을 트리거
                }
                return prev; // 변동이 없다면 이전 상태 주소값을 그대로 반환하여 불필요 연산 차단
            });
        };

        // SVAR Gantt API 내부의 독립적인 Grid(Table) 컴포넌트에 접근하여 조작 (Promise 형태로 반환될 수도 있으므로 보장성 then 체이닝 사용)
        Promise.resolve(api.getTable?.()).then((ta: any) => {
            if (!isMounted) return; // 비동기 대기 중 이미 다른 페이지로 빠져나가 마운트 해제되었다면 무시 처리
            if (ta) {
                tableApi = ta; // Grid API 인스턴스 객체를 언마운트 Cleanup용으로 글로벌 변수에 저장
                tableApi.on("resize-column", handleResizeColumn); // 넓이가 변경되는 네이티브 이벤트를 감지하도록 핸들러를 연결
            }
        });

        const handleUpdate = (ev: any) => {
            const { id, task, inProgress } = ev; // 이벤트 객체에서 대상 ID, 업데이트된 task 요소, 마우스 드래그 중인지(inProgress) 판단 여부 추출
            if (inProgress || !task) return; // 드래그 중이거나 대상 task가 없으면 잦은 렌더링 방지를 위해 무시 처리

            setRows((prev) => {
                const newRows = prev.map((row) => {
                    if (row.id !== id) return row; // 업데이트 대상 ID가 아닌 행은 기존 데이터 그대로 유지

                    const nextRow: EditableWbsRow = { ...row }; // 불변성(Immutability) 유지를 위해 기존 객체를 복사

                    const nextStartDate =
                        task.start !== undefined
                            ? toOptionalDateInputValue(task.start) // 간트에서 전달받은 Date 객체를 'YYYY-MM-DD' 문자열 형태로 변환
                            : row.startDate; // 변경 사항이 없으면 기존 착수일 활용

                    const nextEndDate =
                        task.end !== undefined
                            ? toOptionalDateInputValue(task.end) // 간트에서 전달받은 Date 객체를 'YYYY-MM-DD' 문자열 형태로 변환
                            : row.endDate; // 변경 사항이 없으면 기존 종료일 활용

                    nextRow.startDate = nextStartDate; // 도출된 새로운 착수일 덮어쓰기
                    nextRow.endDate = nextEndDate; // 도출된 새로운 종료일 덮어쓰기

                    // 수정된 시작/종료일 기준으로 작업 기간 재산정
                    const nextDuration = hasBothDates(nextRow.startDate, nextRow.endDate)
                        ? computeDurationDays(nextRow.startDate, nextRow.endDate) // 두 날짜가 모두 유효하면 실제 소요 일수 연산 수행
                        : null; // 한 쪽이라도 날짜가 없으면 기간 불명 처리

                    nextRow.durationDays = nextDuration != null ? String(nextDuration) : null; // 산출된 숫자 일수를 문자열로 형태 변환하여 세팅

                    if (task.text !== undefined) nextRow.workName = String(task.text ?? ""); // 트리그리드/차트상에서 텍스트(공종명)를 수정했다면 저장
                    if (task.predecessorCode !== undefined) nextRow.predecessorCode = String(task.predecessorCode ?? "").trim(); // 선행작업 수정 시 앞뒤 공백 제거 후 적용
                    if (task.relationType !== undefined) nextRow.relationType = normalizeRelationType(task.relationType); // 잘못된 타입값 방지를 위해 정규화 후 관계 지정(FS, SS 등)
                    if (task.lag !== undefined) nextRow.lag = String(task.lag) || ""; // Lag(시차) 수정 시 처리 빈 값이면 공백 문자열

                    return nextRow; // 변경이 완료된 행 데이터를 반환
                });

                return rebuildFromRows(newRows); // 변경된 rows 데이터를 토대로 화면(트리, 간트 차트 연결 구조 등) 재구축
            });
        };

        // zoom-scale 이벤트에서는 절대 rows / calendarRange를 건드리지 않고 zoom 방향값만 반영
        const handleZoom = (ev: any) => {
            const dir = Number(ev?.dir); // 휠 입력이나 버튼 조작으로 발생한 줌 인/아웃 방향 (+1 또는 -1 추출)
            if (!Number.isFinite(dir)) return; // 올바른 숫자 형태가 아니면 오작동 방지를 위해 스킵
            changeZoomBy(dir); // 실제 상태(State)의 줌 레벨을 증감하는 함수 트리거
        };

        // 행 재정렬(세로 드래그)만 차단
        const blockRowReorder = (ev: any) => {
            if (typeof ev?.top !== "undefined") {
                return false;
            }
        };

        api.on("update-task", handleUpdate);
        api.on("zoom-scale", handleZoom);
        api.intercept("drag-task", blockRowReorder);

        return () => {
            isMounted = false; // 컴포넌트 언마운트 시 안전을 위해 Flag 비활성화

            if (typeof api.off === "function") {
                api.off("update-task", handleUpdate);
                api.off("zoom-scale", handleZoom);
            } else if (typeof api.detach === "function") {
                api.detach("update-task", handleUpdate);
                api.detach("zoom-scale", handleZoom);
            }

            // intercept 해제
            if (typeof api.detach === "function") {
                api.detach("drag-task", blockRowReorder);
            } else if (typeof api.off === "function") {
                api.off("drag-task", blockRowReorder);
            }

            // Grid 컴포넌트에 직접 부착했던 넓이 조절(resize) 감지 리스너 해제 (이벤트 리스너 중첩 및 메모리 누수 방지 목적)
            if (tableApi) {
                if (typeof tableApi.detach === "function") tableApi.detach("resize-column", handleResizeColumn);
                else if (typeof tableApi.off === "function") tableApi.off("resize-column", handleResizeColumn);
            }
        };
    }, [api, setRows, rebuildFromRows, changeZoomBy, setColumnConfig]);
}