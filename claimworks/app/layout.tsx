import type { ReactNode } from "react";

export const metadata = {
  title: "Reliquify",
  description: "IEEPA tariff refund claim-operations",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, Arial, sans-serif", color: "#1a1a1a", background: "#f6f7f9" }}>
        {children}
      </body>
    </html>
  );
}
