import { useCallback } from "react";

type Props = {
    value: any;
    formatter?: (val: any) => string;
};

export default function CopyCell({ value, formatter }: Props) {
    const displayValue =
        formatter?.(value) ?? (value != null ? String(value) : "-");

    const handleCopy = useCallback(() => {
        if (value == null) return;

        navigator.clipboard.writeText(displayValue);
    }, [value, displayValue]);

    return (
        <span
            title="더블클릭해서 복사"
            onDoubleClick={handleCopy}
            style={{
                cursor: value != null ? "pointer" : "default",
                userSelect: "none",
            }}
        >
            {displayValue}
        </span>
    );
}