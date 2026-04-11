import type { Metadata } from 'next';
import { RoomViewer } from '@/components/room-viewer';

// Room viewer page. The room name comes from the URL path segment and
// is passed straight through to the RoomViewer component — rooms are
// ephemeral, there's no server-side room registry to look up, and the
// viewer joins the relay via the browser WebSocket at mount time.

interface RoomPageProps {
    params: Promise<{ room: string }>;
}

export async function generateMetadata({
    params,
}: RoomPageProps): Promise<Metadata> {
    const { room } = await params;
    const roomName = decodeURIComponent(room);
    return {
        title: `${roomName} · openroom`,
        description: `Live view of room/${roomName} on openroom.channel.`,
    };
}

export default async function RoomPage({ params }: RoomPageProps) {
    const { room } = await params;
    const roomName = decodeURIComponent(room);
    return <RoomViewer room={roomName} />;
}
