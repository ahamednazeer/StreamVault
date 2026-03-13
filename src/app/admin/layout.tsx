import DashboardLayout from "@/components/DashboardLayout";

export default function AdminLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return <DashboardLayout>{children}</DashboardLayout>;
}
