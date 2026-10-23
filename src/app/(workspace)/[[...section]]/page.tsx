import Workspace from '@/components/Workspace';
import { currentActor } from '@/lib/auth';
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  return <Workspace section={(await params).section || []} actor={await currentActor()} />;
}
