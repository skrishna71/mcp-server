import { z } from 'zod';
import { ExpressHttpStreamableMcpServer } from "./server_runner.js";
import axios from "axios";


const PORT = 3000;
const authToken='WnJnMUNXNTZ3Z0FNTkNZTW4yNXhHbXRzSkNKQ0pPdHJHQXlqZDdxWE9DX0JTMlk5b2pyWGNPWHBOcEhTSGNhT0FaZVhQYWo4OEV6clRPZDRVLW9ZTHUwWTFIUmV1ZjVYbG9NbVhidU5tV0d4a1NIOFVXTTVqaXlHaE44TmZoLW51QnlESGtrTUp2R3FFVFhWNUJoeWhXQmFuWDd6RW56UVJZWlBfTHJ3RVRJT0hPenowTXdNQWdEalBUQ1E3MWk1M2RoVmIzZEpxTWFjaTAtb3ZndU1OUDctZ3FhZVUtZ2FJNjZKaTkySHg4Z09aUk9PZERmYVFUcnIxdkZrYXlrWUhFTlI3aDR3a0xFPTo='
const spaceId = 'spa_t63vxRbWPHspsT6jDbQ6Ru'; // Replace with your actual space ID

console.log("Initializing MCP Streamable-HTTP Server with Express")

const getprofileSchema = {
  collection: z.enum(["users", "accounts"]),
  id: z.string()
};

const listEventsSchema = {
  collection: z.enum(["users", "accounts"]),
  id: z.string(),
  since: z.string().optional(), 
  limit: z.coerce.number().int().min(1).max(200).optional(), 
  cursor: z.string().optional(),
}

const searchEventsSchema = {
  id: z.string(),
  name: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional() 
}

const profileSnapshotSchema = {
  collection: z.enum(["users", "accounts"]),
  id: z.string(),
  lastDays: z.coerce.number().int().max(30).default(14)
}

const headers = { 'Authorization' : `Basic ${authToken}`, 'Content-Type': 'application/json' };

const toolCache: Record<string, any> = {};


 
const servers = ExpressHttpStreamableMcpServer(
  {
    name: "sgprofile",
  },
  server => {

    // ... set up server resources, tools, and prompts ...
    server.tool(
      "getProfile",
      "get the traits of a user or account",
      getprofileSchema,
      async ({ collection,id }) => {
          const baseUrl = `https://profiles.segment.com/v1/spaces/${spaceId}/collections/${collection}/profiles/user_id:${id}`;
    try{
      const url = `${baseUrl}/traits`;
      
      const response = await axios.get(url, {headers});

      if (response.status < 200) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.data;
      return data;
    } catch (error) {
      throw new Error( `Failed to fetch profile: ${error}`);
    }
      }
    );


    server.tool(
      "listEvents",
      "List events for a user or account",
      listEventsSchema,
      async ({collection,id,since,limit,cursor}) => {
            const baseUrl = `https://profiles.segment.com/v1/spaces/${spaceId}/collections/${collection}/profiles/user_id:${id}`;
    try{
      let para : string= ``;
      if( limit || since || cursor ){
        para+= `?`;
          para+= limit ? `limit=${limit}`:`limit=1`;
        if(since){
          para+= `&start=${since}`;
        }
        if(cursor){
          para+= `&next=${cursor}`;
        }
      }
      const url = `${baseUrl}/events${para}`;
      const response = await axios.get(url, {headers});

      if(response.status < 200 ){
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.data;
      toolCache[`listEvents`+ id] = data;
      return data;
    }catch (error) {
      throw new Error(`Failed to fetch events: ${error}`);
    }
      }
    );


    // Register a tool that sends multiple greetings with notifications
    server.tool(
      "searchEvents",
      " Client-side filter on listEvents output; narrows by event name and time window ",
      searchEventsSchema,
      async ({ id, name,after, before })=> {
        const cachedEvents = toolCache[`listEvents` + id];
        if(!cachedEvents || !Array.isArray(cachedEvents.data)|| cachedEvents.data.length === 0){
            throw new Error("No cached events found. Please call listEvents first.");
        }
        try{
            const filteredEvents = cachedEvents.data.filter((event: any) => {
                const eventNameMatches = !name || event.event === name;
                const afterDateMatches = !after || new Date(event.timestamp).toISOString().split('T')[0] >= new Date(after).toISOString().split('T')[0];
                const beforeDateMatches = !before || new Date(event.timestamp).toISOString().split('T')[0] <= new Date(before).toISOString().split('T')[0];
                return eventNameMatches && afterDateMatches && beforeDateMatches;
            });
            return filteredEvents;
        }catch(error){
            throw new Error(`Failed to search events: ${error}`);
        }
      }
    );

    server.tool(
        "profileSnapshot",
        " pulls traits and last n days of events and returns { traits, events } in one call (reduces round-trips)",
        profileSnapshotSchema,
        async( { collection,id,lastDays})=>{
            const baseUrl = `https://profiles.segment.com/v1/spaces/${spaceId}/collections/${collection}/profiles/user_id:${id}`;
            const startDate = new Date(Date.now() - lastDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            try{
                const traitsUrl = `${baseUrl}/traits`;
                const eventsUrl = `${baseUrl}/events?start=${startDate}`; 
                const [traitsRes, eventsRes] = await Promise.all([
                    axios.get(traitsUrl, { headers }),
                    axios.get(eventsUrl, { headers })
                ]);

                if(traitsRes.status < 200 || eventsRes.status < 200){
                    throw new Error(`HTTP error! status: ${traitsRes.status}and ${eventsRes.status}`);
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: `Succedfully fetched profile snapshot for ${collection} with ID ${id}.`
                        }
                    ],
                    traits: traitsRes.data,
                    events: eventsRes.data
                }
            }catch (error) {
                throw new Error(`Failed to fetch events: ${error}`);
            }
        }
    );
})