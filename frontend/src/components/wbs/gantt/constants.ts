import type React from "react";
import type { GanttSizeSettings } from "../../../pages/GanttSizeSettingsPanel";

// 날짜 input 공통 스타일
// 착수일 / 종료일 컬럼에서 동일한 UI를 유지하기 위해 별도 상수로 분리한다.
// width: 셀 폭에 맞춰 가득 차게 표시
// height: 표 안에서 높이를 일정하게 맞춤
// border / borderRadius: 기본 입력창 형태 지정
// padding: 좌우 내부 여백
// boxSizing: padding, border를 포함한 실제 크기 계산 방식
export const DATE_INPUT_STYLE: React.CSSProperties = {
    width: "100%",
    height: 30,
    border: "1px solid #d1d5db",
    borderRadius: 4,
    padding: "0 8px",
    background: "#fff",
    boxSizing: "border-box",
    fontSize: 13,
};

export const DEFAULT_SIZE_SETTINGS: GanttSizeSettings = {
    cellWidth: 100,
    cellHeight: 38,
    scaleHeight: 36,
};
