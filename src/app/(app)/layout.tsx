import { AppProvider } from "@/lib/app-context";
import { Shell } from "@/components/shell/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppProvider><Shell>{children}</Shell></AppProvider>;
}
