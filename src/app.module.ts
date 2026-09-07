import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { CacheModule } from "@nestjs/cache-manager";
import { EvaluationsModule } from "./evaluations/evaluations.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule.register({
      isGlobal: true,
      ttl: 5 * 60 * 1000, // 5 minutes — raw-data is a batch import, not live-updating every second
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>("MONGODB_URI"),
        // Without these, a slow/unreachable Atlas cluster just hangs
        // silently — these turn that into a fast, visible failure instead.
        serverSelectionTimeoutMS: 10_000,
        connectTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
      }),
    }),
    EvaluationsModule,
  ],
})
export class AppModule {}