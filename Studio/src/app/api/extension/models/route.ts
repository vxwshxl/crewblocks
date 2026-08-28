import { NextResponse, NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { compileStack, readStack } from '@/lib/blocks';

export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient();
        
        let { data: authData } = await supabase.auth.getUser();
        let userId = authData?.user?.id;

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

        let squadChatflows: Array<{ id: string; name: string; data: any }> = [];
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

            squadChatflows = (squadWorkflowLinks || [])
                .map((item: any) => item.chatflows)
                .filter(Boolean);
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
            try {
                hasFileUpload = compileStack(readStack(cf.data), cf.name).hasFileUpload;
            } catch {
                // A malformed row should still list, just without uploads.
            }

            return {
                id: cf.id,
                name: cf.name,
                hasFileUpload
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
