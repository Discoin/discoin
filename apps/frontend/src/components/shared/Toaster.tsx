import { useEffect, useState } from "preact/hooks";
import { toasts, type Toast } from "../../lib/toasts.js";
import "./Toaster.scss";

export function Toaster() {
  const [shown, setShown] = useState<Toast[]>([]);

  useEffect(() => toasts.subscribe(setShown), []);

  return (
    <div class="toaster" role="status" aria-atomic="false">
      {shown.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const { id, message } = toast;

  return (
    <div
      class="toast"
      onMouseEnter={() => toasts.hold(id)}
      onMouseLeave={() => toasts.release(id)}
      onFocusIn={() => toasts.hold(id)}
      onFocusOut={() => toasts.release(id)}
    >
      <p class="toast__message">{message}</p>
      <button
        type="button"
        class="toast__close"
        aria-label="Close notification"
        onClick={() => toasts.dismiss(id)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
