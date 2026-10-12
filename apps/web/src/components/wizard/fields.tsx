import type { InputHTMLAttributes, ReactNode } from "react";

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function TextField({ id, label, error, hint, className, inputClassName, value, onValue, ...rest }: FieldProps & { value: string; onValue: (v: string) => void; inputClassName?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id">) {
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className={`input ${inputClassName ?? ""}`} value={value} onChange={(e) => onValue(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
      {hint ? (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-err`} className="err">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextAreaField({ id, label, error, hint, className, value, onValue, maxLength }: FieldProps & { value: string; onValue: (v: string) => void; maxLength?: number }) {
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="input" value={value} maxLength={maxLength} onChange={(e) => onValue(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} />
      {hint ? (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-err`} className="err">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function SelectField({ id, label, error, hint, className, value, onValue, placeholder, options }: FieldProps & { value: string; onValue: (v: string) => void; placeholder?: string; options: readonly { value: string; label: string }[] }) {
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onValue(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)}>
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-err`} className="err">
          {error}
        </span>
      ) : null}
    </div>
  );
}
