import React from "react";
import { Gantt } from "@svar-ui/react-gantt";

/**
 * Gantt의 zoom prop 설정 객체 타입
 * boolean | undefined를 제외한 순수 설정 객체 타입만 추출.
 */
export type GanttZoomConfig = Exclude<NonNullable<React.ComponentProps<typeof Gantt>["zoom"]>, boolean>;

// 상단/하단 스케일에 표시할 날짜 문자열 포맷 함수들
// 문자열 포맷("yyyy", "MMMM yyyy" 등)이 현재 SVAR Gantt 버전에서 해석되지 않고 그대로 출력될 수 있어서,
// 직접 표시 문자열을 만들어 반환하는 방식으로 처리한다.

// 일/주말 CSS 클래스 (scale 용)
export const weekendCss = (date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 6 ? "sday" : "";
};

// 숫자를 2자리 문자열로 맞춰주는 함수 (예: 3 -> "03")
export const pad2 = (value: number): string => String(value).padStart(2, "0");

// 연도 표시: 2026년
export const formatYear = (date: Date): string => `${date.getFullYear()}년`;
// 분기 표시: 1분기, 2분기 ...
export const formatQuarter = (date: Date): string => {
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    return `${quarter}분기`;
};
// 연-월 표시: 2026년 03월
export const formatYearMonth = (date: Date): string => `${date.getFullYear()}년 ${pad2(date.getMonth() + 1)}월`;
// 월만 표시: 03월
export const formatMonth = (date: Date): string => `${pad2(date.getMonth() + 1)}월`;
// 일 표시: 01일, 02일 ...
export const formatDay = (date: Date): string => `${pad2(date.getDate())}일`;
// 시간 표시: 06:00, 13:00
export const formatHourMinute = (date: Date): string => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
// 주차 계산 함수 (해당 연도의 간략한 N주차 계산)
export const formatWeek = (date: Date): string => {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const diffDays = Math.floor((date.getTime() - firstDay.getTime()) / 86400000);
    const week = Math.floor(diffDays / 7) + 1;
    return `${week}주차`;
};

/**
 * 초기 Gantt 줌(Zoom) 설정 객체를 생성합니다.
 * levels: 각 zoom 단계별로 어떤 단위(연/월/주/일/시간)로 표시할지 정의
 */
export const createInitialZoomConfig = (): GanttZoomConfig => ({
    level: 2,
    minCellWidth: 35,
    maxCellWidth: 200,
    levels: [
        {
            minCellWidth: 35, maxCellWidth: 200,
            scales: [{ unit: "year", step: 1, format: formatYear }],
        },
        {
            minCellWidth: 35, maxCellWidth: 200,
            scales: [
                { unit: "month", step: 1, format: formatYearMonth },
            ],
        },
        {
            minCellWidth: 35, maxCellWidth: 200,
            scales: [
                { unit: "month", step: 1, format: formatMonth },
                { unit: "day", step: 1, format: formatDay, css: weekendCss },
            ],
        }

    ],
} as GanttZoomConfig);
