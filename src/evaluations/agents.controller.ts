import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { Controller, Get, NotFoundException, Query, UseInterceptors } from "@nestjs/common";
import { EvaluationsService } from "./evaluations.service";

@Controller("agents")
@UseInterceptors(CacheInterceptor)
export class AgentsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Get()
  @CacheTTL(60 * 1000)
  getAgents() {
    return this.evaluationsService.getAgentsList();
  }

  @Get("summary")
  @CacheTTL(60 * 1000) // CacheInterceptor keys by full URL, so ?email=a and ?email=b cache separately
  async getAgentSummary(@Query("email") email: string) {
    if (!email) {
      throw new NotFoundException("Missing required query param: email");
    }
    const summary = await this.evaluationsService.getAgentSummary(email);
    if (!summary) {
      throw new NotFoundException(`No evaluations found for agent: ${email}`);
    }
    return summary;
  }
}