import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Evaluation, EvaluationSchema } from "./schemas/evaluations.schema";
import { EvaluationsService } from "./evaluations.service";
import { EvaluationsController } from "./evaluations.controller";
import { AgentsController } from "./agents.controller";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Evaluation.name, schema: EvaluationSchema }]),
  ],
  providers: [EvaluationsService],
  controllers: [EvaluationsController, AgentsController],
})
export class EvaluationsModule {}