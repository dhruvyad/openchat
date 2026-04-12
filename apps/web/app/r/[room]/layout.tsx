// Room viewer uses its own full-screen layout (no nav bar) so the
// three-column Discord-style UI can use the full viewport height.
// The room name and navigation are handled within the viewer itself.
export default function Layout({ children }: LayoutProps<'/r/[room]'>) {
    return <>{children}</>;
}
