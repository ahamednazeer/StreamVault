import DashboardLayout from "@/components/DashboardLayout";

export default function DashboardRootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return <DashboardLayout>{children}</DashboardLayout>;
}
