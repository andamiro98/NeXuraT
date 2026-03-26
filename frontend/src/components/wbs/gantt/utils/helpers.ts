import type { RelationType, EditableWbsRow } from "../../types";
import { toDateInputValue } from "../../scheduleUtils";

/**
 * 관계유형 정규화 함수
 * @param value 들어오는 임의의 값
 * @returns 허용되는 RelationType ("FS" | "FF" | "SS" | "SF" | "")
 * @description 엑셀, 사용자 편집, Gantt 내부 이벤트에서 들어오는 값을 일관된 관계유형으로 통일합니다.
 */
export function normalizeRelationType(value: unknown): RelationType {
    if (value === "FS" || value === "FF" || value === "SS" || value === "SF") {
        return value;
    }
    return "";
}

/**
 * 날짜 input 값 정규화 함수
 * @param value 임의의 날짜, 문자열 등
 * @returns <input type="date">에 사용할 수 있는 "YYYY-MM-DD" 형태의 문자열. 파싱 불가능 시 "".
 */
export function toOptionalDateInputValue(value: unknown): string {
    if (value == null || value === "") return "";
    if (typeof value === "string" || value instanceof Date) {
        return toDateInputValue(value);
    }
    return "";
}

/**
 * 시작일 / 종료일 동시 존재 여부 검사
 * @returns 둘 다 참 같은 값(truthy)이면 true
 */
export function hasBothDates(startDate: unknown, endDate: unknown): boolean {
    return !!startDate && !!endDate;
}

/**
 * 날짜 유효성 검사
 * @param value 해석할 대상 날짜 값
 * @returns 유효한 날짜 여부. (Start / end 차트 바 생성 테스트 용)
 */
export function hasValidDate(value: unknown): boolean {
    if (value == null || value === "") return false;
    const d = new Date(value as any);
    return !Number.isNaN(d.getTime());
}

/**
 * localStorage 데이터를 안전하게 읽어오는 함수
 * SSR / 테스트 환경 대응
 */
export function safeGetLocalStorage(key: string): string | null {
    try {
        if (typeof window === "undefined") return null;
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

/**
 * localStorage에 데이터를 안전하게 기록하는 함수
 */
export function safeSetLocalStorage(key: string, value: string): void {
    try {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(key, value);
    } catch {
        // 무시
    }
}

/**
 * 하위 노드 ID 식별 함수
 * 삭제 시 대상이 되는 모든 자식 트리의 ID를 수집합니다.
 */
export function collectDescendantIds(targetId: number, sourceRows: EditableWbsRow[]): Set<number> {
    const ids = new Set<number>([targetId]);
    let changed = true;

    while (changed) {
        changed = false;
        for (const row of sourceRows) {
            const parentId = Number(row.parentId ?? 0);
            const rowId = Number(row.id);

            if (ids.has(parentId) && !ids.has(rowId)) {
                ids.add(rowId);
                changed = true;
            }
        }
    }
    return ids;
}
