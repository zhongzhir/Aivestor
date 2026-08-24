import { requireAuth } from "@/lib/auth";
import ScreeningBatchClient from "./ScreeningBatchClient";
export default async function ScreeningBatchPage({params}:{params:{batchId:string}}) { await requireAuth(); return <ScreeningBatchClient batchId={params.batchId}/>; }
