import { NextResponse, NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { compileStack, readStack, DEFAULT_VISION } from '@/lib/blocks';

/** One row of `chatflows`, as the agent list needs it. */
interface ChatflowRow {
    id: string;
    name: string;
    data: unknown;
}

export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient();
        
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData?.user?.id;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: userChatflows, error } = await supabase
            .from('chatflows')
            .select('id, name, data')
            .eq('user_id', userId);
        
        if (error) throw error;

        const { data: memberships, error: membershipsError } = await supabase
            .from('squad_members')
            .select('squad_id')
            .eq('user_id', userId);

        if (membershipsError) throw membershipsError;

        const memberSquadIds = (memberships || []).map((membership) => membership.squad_id);

        let squadChatflows: ChatflowRow[] = [];
        if (memberSquadIds.length > 0) {
            const { data: squadWorkflowLinks, error: squadWorkflowsError } = await supabase
                .from('squad_chatflows')
                .select(`
                    chatflow_id,
                    chatflows (
                        id,
                        name,
                        data
                    )
                `)
                .in('squad_id', memberSquadIds);

            if (squadWorkflowsError) throw squadWorkflowsError;

            squadChatflows = (squadWorkflowLinks as unknown as Array<{ chatflows?: ChatflowRow }>)
                .map((item) => item.chatflows)
                .filter((row): row is ChatflowRow => !!row);
        }

        // Check if the chatflow contains the File Upload tool
        const combinedChatflows = [...(userChatflows || []), ...squadChatflows];
        const uniqueChatflows = Array.from(
            new Map(combinedChatflows.map((chatflow) => [chatflow.id, chatflow])).values()
        );

        // The side panel only needs to know whether to offer a file picker,
        // which the compiled stack answers directly.
        const processedModels = uniqueChatflows.map(cf => {
            let hasFileUpload = false;
            // The side panel has to know before its first turn whether to
            // capture and mark a screenshot, so the stack's vision settings
            // ship with the agent list rather than waiting for a chat reply.
            let vision = DEFAULT_VISION;

            try {
                const compiled = compileStack(readStack(cf.data), cf.name);
                hasFileUpload = compiled.hasFileUpload;
                vision = compiled.vision;
            } catch {
                // A malformed row should still list, just with safe defaults.
            }

            return {
                id: cf.id,
                name: cf.name,
                hasFileUpload,
                vision
            };
        });

        const response = NextResponse.json({ models: processedModels });
        
        // Add CORS headers for the extension
        response.headers.set('Access-Control-Allow-Origin', req.headers.get('origin') || '*');
        response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        response.headers.set('Access-Control-Allow-Credentials', 'true');

        return response;

    } catch (e) {
        console.error(e);
        return NextResponse.json({ models: [] }, { status: 500 });
    }
}

export async function OPTIONS() {
    const response = new NextResponse(null, { status: 204 });
    response.headers.set('Access-Control-Allow-Origin', '*'); // Or specific origin
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    return response;
}
