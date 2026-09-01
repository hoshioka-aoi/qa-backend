import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";
 
export type ComplianceValue =
  | "เป็นไปตามมาตรฐาน" // meets standard
  | "ไม่เป็นไปตามมาตรฐาน" // does not meet standard
  | "ไม่สามารถประเมินได้" // not applicable
  | "ไม่แสดงพฤติกรรม"; // behavior not observed (section 5 items only)
 
export type EvaluationDocument = Evaluation & Document;
 
@Schema({ collection: "raw-data", strict: false })
export class Evaluation {
  @Prop() document_no: string;
  @Prop() evaluator_employee_id: string;
  @Prop() evaluatee_full_name: string;
  @Prop() position: string;
  @Prop() department: string;
  @Prop() group: string;
  @Prop() employee_email: string;
 
  @Prop() customer_date: string;
  @Prop() service_type: string;
  @Prop() contact_subject: string;
  @Prop() service_format: string;
  @Prop() skill_phone: string;
  @Prop() skill_non_phone: string;
 
  @Prop() evaluation_date: string;
  @Prop() evaluation_performed_date: string;
  @Prop() evaluation_result: "Pass" | "Fail";
 
  // The 19 scored criteria. Fields ending in _critical_bus / _critical_eu /
  // _critical_com are critical criteria — see CRITERIA in evaluations.service.ts,
  // which is the single source of truth for which fields are critical and how
  // they're labeled for display. Kept here mainly for typing/IDE support.
  @Prop() greeting_introduction_and_closing_per_standard: ComplianceValue;
  @Prop() request_customer_name_and_phone_per_standard_critical_bus: ComplianceValue;
  @Prop() hold_call_per_standard: ComplianceValue;
  @Prop() summarize_service_issue_before_closing: ComplianceValue;
  @Prop() communicate_information_clearly_critical_eu: ComplianceValue;
  @Prop() correct_use_of_customer_name_pronoun: ComplianceValue;
  @Prop() no_extraneous_noise_during_call: ComplianceValue;
  @Prop() enthusiasm_and_courtesy_in_service_critical_eu: ComplianceValue;
  @Prop() inquire_and_listen_to_identify_customer_needs_correctly_critical_eu: ComplianceValue;
  @Prop() communicate_and_resolve_issue_per_process_critical_eu: ComplianceValue;
  @Prop() confirm_important_information_per_standard_critical_eu: ComplianceValue;
  @Prop() check_service_history_for_continuity_critical_eu: ComplianceValue;
  @Prop() verify_important_information_per_requirement_critical_com: ComplianceValue;
  @Prop() maintain_organization_image_critical_bus: ComplianceValue;
  @Prop() up_selling_and_cross_selling: ComplianceValue;
  @Prop() correct_field_selection_and_verification_critical_bus: ComplianceValue;
  @Prop() data_entry_accuracy_critical_bus: ComplianceValue;
  @Prop() follow_up_with_customer_per_standard_critical_eu: ComplianceValue;
  @Prop() close_case_and_handoff_correctly_critical_bus: ComplianceValue;
 
  // Section 5 "bonus" behaviors — not part of critical/non-critical scoring
  @Prop() service_exceeded_customer_expectations: string;
  @Prop() voc_positive_compliment: string;
  @Prop() voc_negative_complaint: string;
 
  @Prop() coach_date: string;
  @Prop() coach_name: string;
  @Prop() coach_performed_date: string;
  @Prop() status_coach: string;
 
  @Prop() accept_evaluation_result: string;
  @Prop() status_acknowledge: "Complete" | "Pending";
  @Prop() date_agent_confirm: string;
 
  @Prop() status_flow: "Completed" | "In Progress" | "Pending";
  @Prop() evaluator_name: string;
  @Prop() ticket_no: string;
 
  @Prop() score_part1: number;
  @Prop() score_part2: number;
  @Prop() score_part3: number;
  @Prop() score_part4: number;
  @Prop() score_part5: number;
  @Prop() score_sum: number;
 
  @Prop() critical_yes: number;
  @Prop() critical_no: number;
  @Prop() non_critical_yes: number;
  @Prop() non_critical_no: number;
  @Prop() critical_sum: number;
  @Prop() non_critical_sum: number;
 
  @Prop() modified: string;
  @Prop() item_type: string;
  @Prop() path: string;
}
 
export const EvaluationSchema = SchemaFactory.createForClass(Evaluation);
