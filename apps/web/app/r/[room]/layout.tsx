import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

// Room viewer shares the global HomeLayout so the nav bar is consistent
// with the landing page. The viewer pane itself manages its own height.
export default function Layout({ children }: LayoutProps<'/r/[room]'>) {
    return <HomeLayout {...baseOptions()}>{children}</HomeLayout>;
}
