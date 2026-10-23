import { redirect } from 'next/navigation';
import { currentActor } from '@/lib/auth';
import Shell from '@/components/Shell';
export const dynamic = 'force-dynamic';
export default async function WorkspaceLayout({children}:{children:React.ReactNode}) {
 const actor = await currentActor().catch(()=>null); if (!actor) redirect('/login');
 return <Shell actor={actor}>{children}</Shell>;
}
