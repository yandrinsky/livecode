import { ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Button } from "antd";

export function DataLoadError({
  title = "Не удалось загрузить данные",
  message,
  onRetry,
  compact = false,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return <div className={`data-load-error ${compact ? "data-load-error--compact" : ""}`} role="alert">
    <WarningOutlined />
    <div><b>{title}</b><span>{message}</span></div>
    <Button size={compact ? "small" : "middle"} icon={<ReloadOutlined />} onClick={onRetry}>Повторить</Button>
  </div>;
}
