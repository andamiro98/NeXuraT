import { formatMoney } from "../../scheduleUtils";

/**
 * 금액 셀 전용 렌더러
 * @param val - 숫자 또는 숫자 문자열이 들어올 수 있음. 값이 없으면 "-"를 표시.
 * @description
 * 숫자를 천 단위 구분기호가 포함된 문자열로 변환합니다.
 * 이 컴포넌트는 재료비 / 노무비 / 경비 / 합계금액 컬럼에서 공통으로 사용됩니다.
 */
const MoneyCell = ({ val }: { val: any }) => {
    return (
        <div
            style={{
                padding: "0 8px",
                width: "100%",
                textAlign: "right",
                color: "#6b7280",
            }}
        >
            {val === 0 || val === "0" ? formatMoney(val) : val ? formatMoney(val) : "-"}
        </div>
    );
};

export default MoneyCell;
